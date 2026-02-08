// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract SimpleStaking is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ========== STATE VARIABLES ==========
    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;
    
    uint256 public rewardRate; // Rewards per second
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public totalStaked;
    uint256 public periodFinish; // When the reward period ends
    
    uint256 private constant PRECISION = 1e18;
    uint256 public constant REWARD_DURATION = 30 days;
    
    // Minimum staking period (in seconds)
    uint256 public constant MIN_STAKING_PERIOD = 7 days;
    
    // ========== MAPPING ==========
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public lastStakeTime;
    
    // ========== EVENTS ==========
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardRateUpdated(uint256 newRate);
    event RewardAdded(uint256 reward);
    
    // ========== MODIFIERS ==========
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }
    
    // ========== CONSTRUCTOR ==========
    constructor(
        address _stakingToken,
        address _rewardToken,
        uint256 _rewardRate
    ) Ownable(msg.sender) {
        require(_stakingToken != address(0), "Invalid staking token");
        require(_rewardToken != address(0), "Invalid reward token");
        require(_rewardRate > 0, "Reward rate must be > 0");
        
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardRate = _rewardRate;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + REWARD_DURATION;
    }
    
    // ========== VIEW FUNCTIONS ==========
    function lastTimeRewardApplicable() public view returns (uint256) {
        return Math.min(block.timestamp, periodFinish);
    }
    
    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored +
            (((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * PRECISION) /
                totalStaked);
    }
    
    function earned(address account) public view returns (uint256) {
        return
            ((balances[account] *
                (rewardPerToken() - userRewardPerTokenPaid[account])) / PRECISION) +
            rewards[account];
    }
    
    function getTotalStaked() external view returns (uint256) {
        return totalStaked;
    }
    
    function getStakingPeriod(address account) external view returns (uint256) {
        if (lastStakeTime[account] == 0) return 0;
        return block.timestamp - lastStakeTime[account];
    }

    function getStakedBalance(address account) external view returns (uint256) {
        return balances[account];
    }
    
    // ========== STAKING FUNCTIONS ==========
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        
        // Update staking time only on first stake
        if (balances[msg.sender] == 0) {
            lastStakeTime[msg.sender] = block.timestamp;
        }
        
        // Transfer token from user to contract
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        
        // Update balances
        balances[msg.sender] += amount;
        totalStaked += amount;
        
        emit Staked(msg.sender, amount);
    }
    
    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(balances[msg.sender] >= amount, "Insufficient staked balance");
        require(
            block.timestamp >= lastStakeTime[msg.sender] + MIN_STAKING_PERIOD,
            "Minimum staking period not met"
        );
        
        // Update balances
        balances[msg.sender] -= amount;
        totalStaked -= amount;
        
        // Reset lastStakeTime if fully withdrawn
        if (balances[msg.sender] == 0) {
            lastStakeTime[msg.sender] = 0;
        }
        
        // Transfer token back to user
        stakingToken.safeTransfer(msg.sender, amount);
        
        emit Withdrawn(msg.sender, amount);
    }
    
    function getReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            
            // Transfer reward to user
            rewardToken.safeTransfer(msg.sender, reward);
            
            emit RewardPaid(msg.sender, reward);
        }
    }
    
    function exit() external {
        require(balances[msg.sender] > 0, "No staked balance");
        require(
            block.timestamp >= lastStakeTime[msg.sender] + MIN_STAKING_PERIOD,
            "Minimum staking period not met"
        );
        
        uint256 amount = balances[msg.sender];
        withdraw(amount);
        getReward();
    }
    
    // ========== ADMIN FUNCTIONS ==========
    function notifyRewardAmount(uint256 reward) external onlyOwner updateReward(address(0)) {
        require(reward > 0, "Cannot notify 0 reward");
        
        // Transfer reward tokens to contract
        rewardToken.safeTransferFrom(msg.sender, address(this), reward);
        
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / REWARD_DURATION;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover) / REWARD_DURATION;
        }
        
        // Ensure reward rate is valid
        require(rewardRate > 0, "Reward rate too low");
        require(
            rewardRate <= rewardToken.balanceOf(address(this)) / REWARD_DURATION,
            "Provided reward too high"
        );
        
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + REWARD_DURATION;
        
        emit RewardAdded(reward);
        emit RewardRateUpdated(rewardRate);
    }
    
    function updateRewardRate(uint256 _rewardRate) external onlyOwner updateReward(address(0)) {
        require(_rewardRate > 0, "Reward rate must be > 0");
        rewardRate = _rewardRate;
        emit RewardRateUpdated(_rewardRate);
    }
    
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        require(tokenAddress != address(stakingToken), "Cannot withdraw staking token");
        require(tokenAddress != address(rewardToken), "Cannot withdraw reward token");
        
        IERC20(tokenAddress).safeTransfer(owner(), tokenAmount);
    }

    // Emergency function to recover stuck reward tokens (only after period finish)
    function recoverExcessRewardTokens() external onlyOwner {
        require(block.timestamp > periodFinish, "Reward period not finished");
        
        uint256 excessRewards = rewardToken.balanceOf(address(this));
        if (excessRewards > 0) {
            rewardToken.safeTransfer(owner(), excessRewards);
        }
    }
}
