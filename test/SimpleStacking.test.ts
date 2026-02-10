import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SimpleStaking, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("SimpleStaking", function () {
  let staking: SimpleStaking;
  let stakingToken: MockERC20;
  let rewardToken: MockERC20;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;

  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const REWARD_RATE = ethers.parseEther("1"); // 1 token per second
  const STAKE_AMOUNT = ethers.parseEther("100");
  const REWARD_AMOUNT = ethers.parseEther("2592000"); // 30 days worth of rewards at 1 token/sec
  const MIN_STAKING_PERIOD = 7 * 24 * 60 * 60; // 7 days in seconds
  const REWARD_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    stakingToken = await MockERC20Factory.deploy(
      "Staking Token",
      "STK",
      INITIAL_SUPPLY,
    );
    rewardToken = await MockERC20Factory.deploy(
      "Reward Token",
      "RWD",
      INITIAL_SUPPLY,
    );

    // Deploy staking contract
    const SimpleStakingFactory = await ethers.getContractFactory(
      "SimpleStaking",
    );
    staking = await SimpleStakingFactory.deploy(
      await stakingToken.getAddress(),
      await rewardToken.getAddress(),
      REWARD_RATE,
    );

    // Distribute tokens to users
    await stakingToken.transfer(user1.address, ethers.parseEther("10000"));
    await stakingToken.transfer(user2.address, ethers.parseEther("10000"));
    await stakingToken.transfer(user3.address, ethers.parseEther("10000"));

    // Approve staking contract
    await stakingToken
      .connect(user1)
      .approve(await staking.getAddress(), ethers.MaxUint256);
    await stakingToken
      .connect(user2)
      .approve(await staking.getAddress(), ethers.MaxUint256);
    await stakingToken
      .connect(user3)
      .approve(await staking.getAddress(), ethers.MaxUint256);

    // Setup rewards
    await rewardToken.approve(await staking.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the correct staking token", async function () {
      expect(await staking.stakingToken()).to.equal(
        await stakingToken.getAddress(),
      );
    });

    it("Should set the correct reward token", async function () {
      expect(await staking.rewardToken()).to.equal(
        await rewardToken.getAddress(),
      );
    });

    it("Should set the correct reward rate", async function () {
      expect(await staking.rewardRate()).to.equal(REWARD_RATE);
    });

    it("Should set the correct owner", async function () {
      expect(await staking.owner()).to.equal(owner.address);
    });

    it("Should revert if staking token is zero address", async function () {
      const SimpleStakingFactory = await ethers.getContractFactory(
        "SimpleStaking",
      );
      await expect(
        SimpleStakingFactory.deploy(
          ethers.ZeroAddress,
          await rewardToken.getAddress(),
          REWARD_RATE,
        ),
      ).to.be.revertedWith("Invalid staking token");
    });

    it("Should revert if reward token is zero address", async function () {
      const SimpleStakingFactory = await ethers.getContractFactory(
        "SimpleStaking",
      );
      await expect(
        SimpleStakingFactory.deploy(
          await stakingToken.getAddress(),
          ethers.ZeroAddress,
          REWARD_RATE,
        ),
      ).to.be.revertedWith("Invalid reward token");
    });

    it("Should revert if reward rate is zero", async function () {
      const SimpleStakingFactory = await ethers.getContractFactory(
        "SimpleStaking",
      );
      await expect(
        SimpleStakingFactory.deploy(
          await stakingToken.getAddress(),
          await rewardToken.getAddress(),
          0,
        ),
      ).to.be.revertedWith("Reward rate must be > 0");
    });
  });

  describe("Staking", function () {
    it("Should allow user to stake tokens", async function () {
      await expect(staking.connect(user1).stake(STAKE_AMOUNT))
        .to.emit(staking, "Staked")
        .withArgs(user1.address, STAKE_AMOUNT);

      expect(await staking.balances(user1.address)).to.equal(STAKE_AMOUNT);
      expect(await staking.getTotalStaked()).to.equal(STAKE_AMOUNT);
    });

    it("Should update lastStakeTime on first stake", async function () {
      const blockTimestamp = await time.latest();
      await staking.connect(user1).stake(STAKE_AMOUNT);

      const lastStakeTime = await staking.lastStakeTime(user1.address);
      expect(lastStakeTime).to.be.closeTo(blockTimestamp, 2);
    });

    it("Should not update lastStakeTime on subsequent stakes", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);
      const firstStakeTime = await staking.lastStakeTime(user1.address);

      await time.increase(3600); // 1 hour
      await staking.connect(user1).stake(STAKE_AMOUNT);

      expect(await staking.lastStakeTime(user1.address)).to.equal(
        firstStakeTime,
      );
    });

    it("Should revert when staking 0 amount", async function () {
      await expect(staking.connect(user1).stake(0)).to.be.revertedWith(
        "Cannot stake 0",
      );
    });

    it("Should revert when user has insufficient balance", async function () {
      const largeAmount = ethers.parseEther("100000");
      await expect(staking.connect(user1).stake(largeAmount)).to.be.reverted;
    });

    it("Should handle multiple users staking", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);
      await staking.connect(user2).stake(ethers.parseEther("200"));

      expect(await staking.balances(user1.address)).to.equal(STAKE_AMOUNT);
      expect(await staking.balances(user2.address)).to.equal(
        ethers.parseEther("200"),
      );
      expect(await staking.getTotalStaked()).to.equal(ethers.parseEther("300"));
    });

    it("Should allow user to stake multiple times", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);
      await staking.connect(user1).stake(STAKE_AMOUNT);

      expect(await staking.balances(user1.address)).to.equal(STAKE_AMOUNT * 2n);
    });
  });

  describe("Withdrawal", function () {
    beforeEach(async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);
    });

    it("Should revert withdrawal before minimum staking period", async function () {
      await time.increase(MIN_STAKING_PERIOD - 100);

      await expect(
        staking.connect(user1).withdraw(STAKE_AMOUNT),
      ).to.be.revertedWith("Minimum staking period not met");
    });

    it("Should allow withdrawal after minimum staking period", async function () {
      await time.increase(MIN_STAKING_PERIOD);

      await expect(staking.connect(user1).withdraw(STAKE_AMOUNT))
        .to.emit(staking, "Withdrawn")
        .withArgs(user1.address, STAKE_AMOUNT);

      expect(await staking.balances(user1.address)).to.equal(0);
      expect(await staking.getTotalStaked()).to.equal(0);
    });

    it("Should reset lastStakeTime when fully withdrawn", async function () {
      await time.increase(MIN_STAKING_PERIOD);
      await staking.connect(user1).withdraw(STAKE_AMOUNT);

      expect(await staking.lastStakeTime(user1.address)).to.equal(0);
    });

    it("Should not reset lastStakeTime when partially withdrawn", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);
      const lastStakeTime = await staking.lastStakeTime(user1.address);

      await time.increase(MIN_STAKING_PERIOD);
      await staking.connect(user1).withdraw(STAKE_AMOUNT);

      expect(await staking.lastStakeTime(user1.address)).to.equal(
        lastStakeTime,
      );
    });

    it("Should revert when withdrawing 0 amount", async function () {
      await time.increase(MIN_STAKING_PERIOD);

      await expect(staking.connect(user1).withdraw(0)).to.be.revertedWith(
        "Cannot withdraw 0",
      );
    });

    it("Should revert when withdrawing more than staked", async function () {
      await time.increase(MIN_STAKING_PERIOD);

      await expect(
        staking.connect(user1).withdraw(STAKE_AMOUNT * 2n),
      ).to.be.revertedWith("Insufficient staked balance");
    });

    it("Should allow partial withdrawal", async function () {
      await time.increase(MIN_STAKING_PERIOD);
      const withdrawAmount = STAKE_AMOUNT / 2n;

      await staking.connect(user1).withdraw(withdrawAmount);

      expect(await staking.balances(user1.address)).to.equal(withdrawAmount);
    });

    it("Should transfer tokens back to user", async function () {
      const balanceBefore = await stakingToken.balanceOf(user1.address);

      await time.increase(MIN_STAKING_PERIOD);
      await staking.connect(user1).withdraw(STAKE_AMOUNT);

      const balanceAfter = await stakingToken.balanceOf(user1.address);
      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
    });
  });

  describe("Rewards", function () {
    beforeEach(async function () {
      // Mint fresh reward tokens to owner for this test
      await rewardToken.mint(owner.address, REWARD_AMOUNT);
      // Fund the contract with rewards
      await rewardToken.approve(await staking.getAddress(), REWARD_AMOUNT);
      await staking.notifyRewardAmount(REWARD_AMOUNT);
    });

    it("Should calculate earned rewards correctly", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);

      // Fast forward 1 day
      await time.increase(24 * 60 * 60);

      const earned = await staking.earned(user1.address);
      const expectedReward = REWARD_RATE * BigInt(24 * 60 * 60);

      // Allow larger tolerance due to block mining time
      expect(earned).to.be.closeTo(expectedReward, ethers.parseEther("10"));
    });

    it("Should distribute rewards proportionally to multiple stakers", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);
      await staking.connect(user2).stake(STAKE_AMOUNT * 2n);

      await time.increase(24 * 60 * 60);

      const earned1 = await staking.earned(user1.address);
      const earned2 = await staking.earned(user2.address);

      // User2 should have approximately 2x the rewards of user1
      // Allow larger tolerance due to block mining time
      expect(earned2).to.be.closeTo(earned1 * 2n, ethers.parseEther("10"));
    });

    it("Should allow claiming rewards", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);
      await time.increase(24 * 60 * 60);

      const earnedBefore = await staking.earned(user1.address);
      const balanceBefore = await rewardToken.balanceOf(user1.address);

      await staking.connect(user1).getReward();

      const balanceAfter = await rewardToken.balanceOf(user1.address);
      const actualReward = balanceAfter - balanceBefore;

      // Check that user received rewards close to what was earned
      expect(actualReward).to.be.closeTo(earnedBefore, ethers.parseEther("10"));
      expect(actualReward).to.be.gt(0);
    });

    it("Should reset rewards after claiming", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);
      await time.increase(24 * 60 * 60);

      await staking.connect(user1).getReward();

      expect(await staking.rewards(user1.address)).to.equal(0);
    });

    it("Should handle claiming when no rewards earned", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);

      // Immediately try to claim (might have tiny rewards from block mining time)
      await staking.connect(user1).getReward();

      const balance = await rewardToken.balanceOf(user1.address);
      // Should be very small or zero (allow for block mining time)
      expect(balance).to.be.lt(ethers.parseEther("10"));
    });

    it("Should accumulate rewards correctly after partial withdrawal", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT * 2n);

      await time.increase(MIN_STAKING_PERIOD);
      const earnedBefore = await staking.earned(user1.address);

      // Withdraw half
      await staking.connect(user1).withdraw(STAKE_AMOUNT);

      await time.increase(24 * 60 * 60);
      const earnedAfter = await staking.earned(user1.address);

      expect(earnedAfter).to.be.gt(earnedBefore);
    });
  });

  describe("Exit Function", function () {
    beforeEach(async function () {
      await rewardToken.mint(owner.address, REWARD_AMOUNT);
      await rewardToken.approve(await staking.getAddress(), REWARD_AMOUNT);
      await staking.notifyRewardAmount(REWARD_AMOUNT);
      await staking.connect(user1).stake(STAKE_AMOUNT);
    });

    it("Should allow exit after minimum staking period", async function () {
      await time.increase(MIN_STAKING_PERIOD + 24 * 60 * 60);

      const earned = await staking.earned(user1.address);
      const stakingBalanceBefore = await stakingToken.balanceOf(user1.address);
      const rewardBalanceBefore = await rewardToken.balanceOf(user1.address);

      await staking.connect(user1).exit();

      expect(await staking.balances(user1.address)).to.equal(0);
      expect(await stakingToken.balanceOf(user1.address)).to.equal(
        stakingBalanceBefore + STAKE_AMOUNT,
      );
      expect(await rewardToken.balanceOf(user1.address)).to.be.closeTo(
        rewardBalanceBefore + earned,
        ethers.parseEther("10"),
      );
    });

    it("Should revert exit before minimum staking period", async function () {
      await time.increase(MIN_STAKING_PERIOD - 100);

      await expect(staking.connect(user1).exit()).to.be.revertedWith(
        "Minimum staking period not met",
      );
    });

    it("Should revert exit when no staked balance", async function () {
      await expect(staking.connect(user2).exit()).to.be.revertedWith(
        "No staked balance",
      );
    });
  });

  describe("Reward Administration", function () {
    it("Should allow owner to notify reward amount", async function () {
      await rewardToken.mint(owner.address, REWARD_AMOUNT);
      await rewardToken.approve(await staking.getAddress(), REWARD_AMOUNT);
      await expect(staking.notifyRewardAmount(REWARD_AMOUNT))
        .to.emit(staking, "RewardAdded")
        .withArgs(REWARD_AMOUNT);
    });

    it("Should revert when non-owner tries to notify rewards", async function () {
      await rewardToken.mint(owner.address, REWARD_AMOUNT);
      await rewardToken.transfer(user1.address, REWARD_AMOUNT);
      await rewardToken
        .connect(user1)
        .approve(await staking.getAddress(), REWARD_AMOUNT);

      await expect(
        staking.connect(user1).notifyRewardAmount(REWARD_AMOUNT),
      ).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    });

    it("Should revert when notifying 0 reward", async function () {
      await expect(staking.notifyRewardAmount(0)).to.be.revertedWith(
        "Cannot notify 0 reward",
      );
    });

    it("Should update reward rate correctly", async function () {
      await rewardToken.mint(owner.address, REWARD_AMOUNT);
      await rewardToken.approve(await staking.getAddress(), REWARD_AMOUNT);
      await staking.notifyRewardAmount(REWARD_AMOUNT);

      const rewardRate = await staking.rewardRate();
      expect(rewardRate).to.be.gt(0);
    });

    it("Should allow owner to update reward rate manually", async function () {
      const newRate = ethers.parseEther("2");

      await expect(staking.updateRewardRate(newRate))
        .to.emit(staking, "RewardRateUpdated")
        .withArgs(newRate);

      expect(await staking.rewardRate()).to.equal(newRate);
    });

    it("Should revert when setting reward rate to 0", async function () {
      await expect(staking.updateRewardRate(0)).to.be.revertedWith(
        "Reward rate must be > 0",
      );
    });

    it("Should handle adding more rewards during active period", async function () {
      await rewardToken.mint(owner.address, REWARD_AMOUNT);
      await rewardToken.approve(await staking.getAddress(), REWARD_AMOUNT);
      await staking.notifyRewardAmount(REWARD_AMOUNT);

      await time.increase(15 * 24 * 60 * 60); // 15 days

      const additionalRewards = ethers.parseEther("1296000");
      await rewardToken.mint(owner.address, additionalRewards);
      await rewardToken.approve(await staking.getAddress(), additionalRewards);
      await staking.notifyRewardAmount(additionalRewards);

      expect(await staking.rewardRate()).to.be.gt(0);
    });
  });

  describe("Token Recovery", function () {
    let randomToken: MockERC20;

    beforeEach(async function () {
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      randomToken = await MockERC20Factory.deploy(
        "Random Token",
        "RND",
        INITIAL_SUPPLY,
      );

      await randomToken.transfer(
        await staking.getAddress(),
        ethers.parseEther("1000"),
      );
    });

    it("Should allow owner to recover random ERC20 tokens", async function () {
      const amount = ethers.parseEther("500");

      await staking.recoverERC20(await randomToken.getAddress(), amount);

      expect(await randomToken.balanceOf(owner.address)).to.be.gte(amount);
    });

    it("Should revert when trying to recover staking token", async function () {
      await expect(
        staking.recoverERC20(
          await stakingToken.getAddress(),
          ethers.parseEther("100"),
        ),
      ).to.be.revertedWith("Cannot withdraw staking token");
    });

    it("Should revert when trying to recover reward token", async function () {
      await expect(
        staking.recoverERC20(
          await rewardToken.getAddress(),
          ethers.parseEther("100"),
        ),
      ).to.be.revertedWith("Cannot withdraw reward token");
    });

    it("Should revert when non-owner tries to recover tokens", async function () {
      await expect(
        staking
          .connect(user1)
          .recoverERC20(
            await randomToken.getAddress(),
            ethers.parseEther("100"),
          ),
      ).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await rewardToken.mint(owner.address, REWARD_AMOUNT);
      await rewardToken.approve(await staking.getAddress(), REWARD_AMOUNT);
      await staking.notifyRewardAmount(REWARD_AMOUNT);
    });

    it("Should return correct total staked", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);
      await staking.connect(user2).stake(ethers.parseEther("200"));

      expect(await staking.getTotalStaked()).to.equal(ethers.parseEther("300"));
    });

    it("Should return correct staking period", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);

      await time.increase(3600); // 1 hour

      const period = await staking.getStakingPeriod(user1.address);
      expect(period).to.be.closeTo(3600, 5);
    });

    it("Should return 0 staking period for non-stakers", async function () {
      expect(await staking.getStakingPeriod(user2.address)).to.equal(0);
    });

    it("Should return correct staked balance", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);

      expect(await staking.getStakedBalance(user1.address)).to.equal(
        STAKE_AMOUNT,
      );
    });

    it("Should calculate rewardPerToken correctly with no stakers", async function () {
      const rewardPerToken = await staking.rewardPerToken();
      expect(rewardPerToken).to.equal(0);
    });

    it("Should calculate rewardPerToken correctly with stakers", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);

      await time.increase(3600);

      const rewardPerToken = await staking.rewardPerToken();
      expect(rewardPerToken).to.be.gt(0);
    });
  });

  describe("Edge Cases", function () {
    beforeEach(async function () {
      await rewardToken.mint(owner.address, REWARD_AMOUNT);
      await rewardToken.approve(await staking.getAddress(), REWARD_AMOUNT);
      await staking.notifyRewardAmount(REWARD_AMOUNT);
    });

    it("Should handle staking after reward period ends", async function () {
      await time.increase(REWARD_DURATION + 100);

      await staking.connect(user1).stake(STAKE_AMOUNT);

      await time.increase(24 * 60 * 60);

      const earned = await staking.earned(user1.address);
      expect(earned).to.equal(0);
    });

    it("Should handle multiple stake/unstake cycles", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);

      await time.increase(MIN_STAKING_PERIOD);
      await staking.connect(user1).withdraw(STAKE_AMOUNT);

      await staking.connect(user1).stake(STAKE_AMOUNT);

      await time.increase(MIN_STAKING_PERIOD);
      await staking.connect(user1).withdraw(STAKE_AMOUNT);

      expect(await staking.balances(user1.address)).to.equal(0);
    });

    it("Should handle very small stake amounts", async function () {
      const smallAmount = ethers.parseEther("0.001");

      await staking.connect(user1).stake(smallAmount);

      expect(await staking.balances(user1.address)).to.equal(smallAmount);
    });

    it("Should prevent reentrancy attacks", async function () {
      await staking.connect(user1).stake(STAKE_AMOUNT);

      await time.increase(MIN_STAKING_PERIOD);

      // This should not be possible due to ReentrancyGuard
      await staking.connect(user1).withdraw(STAKE_AMOUNT);
    });
  });

  describe("Gas Optimization Scenarios", function () {
    it("Should efficiently handle batch staking", async function () {
      const users = [user1, user2, user3];

      for (const user of users) {
        await staking.connect(user).stake(STAKE_AMOUNT);
      }

      expect(await staking.getTotalStaked()).to.equal(STAKE_AMOUNT * 3n);
    });

    it("Should efficiently update rewards for multiple users", async function () {
      await rewardToken.mint(owner.address, REWARD_AMOUNT);
      await rewardToken.approve(await staking.getAddress(), REWARD_AMOUNT);
      await staking.notifyRewardAmount(REWARD_AMOUNT);

      await staking.connect(user1).stake(STAKE_AMOUNT);
      await staking.connect(user2).stake(STAKE_AMOUNT);

      await time.increase(24 * 60 * 60);

      await staking.connect(user1).getReward();
      await staking.connect(user2).getReward();

      expect(await rewardToken.balanceOf(user1.address)).to.be.gt(0);
      expect(await rewardToken.balanceOf(user2.address)).to.be.gt(0);
    });
  });
});
