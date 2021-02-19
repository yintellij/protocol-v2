pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import { LendingPool } from '../protocol/lendingpool/LendingPool.sol';
import {
  LendingPoolAddressesProvider
} from '../protocol/configuration/LendingPoolAddressesProvider.sol';
import { LendingPoolConfigurator } from '../protocol/lendingpool/LendingPoolConfigurator.sol';
import { AToken } from '../protocol/tokenization/AToken.sol';
import {
  DefaultReserveInterestRateStrategy
} from '../protocol/lendingpool/DefaultReserveInterestRateStrategy.sol';
import { Ownable } from '../dependencies/openzeppelin/contracts/Ownable.sol';
import { StableDebtToken } from '../protocol/tokenization/StableDebtToken.sol';
import { VariableDebtToken } from '../protocol/tokenization/VariableDebtToken.sol';
import { LendingRateOracle } from '../mocks/oracle/LendingRateOracle.sol';
import { console } from 'hardhat/console.sol';
import { IAaveOracle } from '../interfaces/IAaveOracle.sol';
import { ILendingRateOracle } from '../interfaces/ILendingRateOracle.sol';


struct InputParams {
    string marketId;
    address poolAdmin;
    address emergencyAdmin;
    address lendingPoolImpl;
    address lendingPoolConfiguratorImpl;
    address aaveOracle;
    address rateOracle;
    address[] tokens;
    address[] aggregators;
    uint256[] rates;
}

/**
 * TODO Contract that handles FULL deployment in few transactions.
 */
contract FullDeployment is Ownable {

    event FirstDeployment(
        address addressesProvider,
        address lendingPool,
        address lendingPoolConfigurator
    );

    // Aave & rate oracles must have this contract set as owner
    function deployOne(
        // string memory marketId,
        // address poolAdmin,
        // address emergencyAdmin,
        // address lendingPoolImpl,
        // address lendingPoolConfiguratorImpl,
        // address aaveOracle,
        // address rateOracle,
        // address[] calldata tokens,
        // address[] calldata aggregators
        // //uint256[] calldata rates
        InputParams memory data
    ) 
        external onlyOwner
    {
        require(
            data.tokens.length == data.aggregators.length /*&&
            tokens.length == rates.length*/,
            "FullDeployment: Array mismatch"
        );

        LendingPoolAddressesProvider provider = new LendingPoolAddressesProvider(data.marketId);
        
        provider.setPoolAdmin(data.poolAdmin);
        provider.setEmergencyAdmin(data.emergencyAdmin);
        provider.setLendingPoolImpl(data.lendingPoolImpl);
        provider.setLendingPoolConfiguratorImpl(data.lendingPoolConfiguratorImpl);
        
        IAaveOracle(data.aaveOracle).setAssetSources(data.tokens, data.aggregators);

        ILendingRateOracle lendingRateOracle = ILendingRateOracle(data.rateOracle);
        for (uint256 i = 0; i < data.tokens.length - 1; i++) {
            lendingRateOracle.setMarketBorrowRate(data.tokens[i], data.rates[i]);
        }
        

        emit FirstDeployment(
            address(provider),
            provider.getLendingPool(),
            provider.getLendingPoolConfigurator()
        );
        // return oracle ownership to sender

    }
}