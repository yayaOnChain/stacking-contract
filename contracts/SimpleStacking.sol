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
    
    uint256 private constant PRECISION = 1e18;
    
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
    }
    
    // ========== VIEW FUNCTIONS ==========
    function lastTimeRewardApplicable() public view returns (uint256) {
        return Math.min(block.timestamp, lastUpdateTime + 30 days); // Max reward period
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
    
    // ========== STAKING FUNCTIONS ==========
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        require(stakingToken.balanceOf(msg.sender) >= amount, "Insufficient balance");
        
        // Update staking time
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
    
    function withdraw(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(balances[msg.sender] >= amount, "Insufficient staked balance");
        require(
            block.timestamp - lastStakeTime[msg.sender] >= MIN_STAKING_PERIOD,
            "Minimum staking period not met"
        );
        
        // Update balances
        balances[msg.sender] -= amount;
        totalStaked -= amount;
        
        // Transfer token back to user
        stakingToken.safeTransfer(msg.sender, amount);
        
        emit Withdrawn(msg.sender, amount);
    }
    
    function getReward() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            
            // Transfer reward to user
            require(
                rewardToken.balanceOf(address(this)) >= reward,
                "Insufficient reward balance"
            );
            rewardToken.safeTransfer(msg.sender, reward);
            
            emit RewardPaid(msg.sender, reward);
        }
    }
    
    function exit() external {
        withdraw(balances[msg.sender]);
        getReward();
    }
    
    // ========== ADMIN FUNCTIONS ==========
    function notifyRewardAmount(uint256 amount) external onlyOwner updateReward(address(0)) {
        require(amount > 0, "Cannot notify 0 reward");
        require(rewardToken.balanceOf(msg.sender) >= amount, "Insufficient reward balance");
        
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        
        uint256 currentRewardPerSecond = rewardRate;
        uint256 newRewardRate = amount / 30 days; // Distribute over 30 days
        
        if (block.timestamp >= lastUpdateTime + 30 days) {
            rewardRate = newRewardRate;
        } else {
            uint256 remaining = rewardRate * (lastUpdateTime + 30 days - block.timestamp);
            rewardRate = (remaining + amount) / 30 days;
        }
        
        lastUpdateTime = block.timestamp;
        emit RewardRateUpdated(rewardRate);
    }
    
    function updateRewardRate(uint256 _rewardRate) external onlyOwner {
        require(_rewardRate > 0, "Reward rate must be > 0");
        rewardRate = _rewardRate;
        emit RewardRateUpdated(_rewardRate);
    }
    
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        require(tokenAddress != address(stakingToken), "Cannot withdraw staking token");
        require(tokenAddress != address(rewardToken), "Cannot withdraw reward token");
        
        IERC20(tokenAddress).safeTransfer(owner(), tokenAmount);
    }
}