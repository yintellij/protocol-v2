import { task } from 'hardhat/config';

import { 
    deployFullDeployment,
    deployLendingPool,
    deployLendingPoolConfigurator,
    deployAaveOracle,
    deployLendingRateOracle,
} from '../../helpers/contracts-deployments';
import { getParamPerNetwork } from '../../helpers/contracts-helpers';
import {
    ConfigNames,
    loadPoolConfig,
    getWethAddress,
    getGenesisPoolAdmin,
    getLendingRateOracles,
} from '../../helpers/configuration';
import {
    getAaveOracle,
    getLendingPoolAddressesProvider,
    getLendingRateOracle,
    getPairsTokenAggregator,
    getFirstSigner,
  } from '../../helpers/contracts-getters';
import { ICommonConfiguration, eEthereumNetwork, SymbolMap, IMarketRates } from '../../helpers/types';
import { waitForTx, notFalsyOrZeroAddress } from '../../helpers/misc-utils';
import { AaveOracle } from '../../types';

task(`deploy-full-test`, `Deploys using the full deployment contract`)
  .addParam('pool', `Pool name to retrieve configuration, supported: ${Object.values(ConfigNames)}`)
  .addFlag('verify', 'Verify contracts on etherscan?')
  .setAction(async ({ verify, pool}, DRE) => {
    await DRE.run('set-DRE');
    // ---
    const network = <eEthereumNetwork>DRE.network.name;
    const poolConfig = loadPoolConfig(pool);
    const {
      ProtocolGlobalParams: { UsdAddress },
      ReserveAssets,
      FallbackOracle,
      ChainlinkAggregator,
    } = poolConfig as ICommonConfiguration;
    const lendingRateOracles = getLendingRateOracles(poolConfig);
    const aaveOracleAddress = getParamPerNetwork(poolConfig.AaveOracle, network);
    const lendingRateOracleAddress = getParamPerNetwork(poolConfig.LendingRateOracle, network);
    const reserveAssets = await getParamPerNetwork(ReserveAssets, network);
    const chainlinkAggregators = await getParamPerNetwork(ChainlinkAggregator, network);
    const fallbackOracleAddress = await getParamPerNetwork(FallbackOracle, network);
    // ---

    let addressesProvider;
    let lendingPool;
    let lendingPoolConfigurator;

    const deployer = await deployFullDeployment();

    // UNNECESSARY IN FINAL DEPLOYMENT: IMPLs should be pre-determined & passed to the task
    const lendingPoolImpl = (await deployLendingPool()).address;
    const lendingPoolConfiguratorImpl = (await deployLendingPoolConfigurator()).address;
    const poolAdmin = await (await getFirstSigner()).getAddress();
    const emergencyAdmin = poolAdmin;

    //--------------------------------
    const tokensToWatch: SymbolMap<string> = {
        ...reserveAssets,
        USD: UsdAddress,
    };
    const [tokens, aggregators] = getPairsTokenAggregator(tokensToWatch, chainlinkAggregators);

    // UNNECESSARY IN FINAL DEPLOYMENT: aaveOracle should be pre-determined & ownership transferred
    let aaveOracle: AaveOracle;
    if (notFalsyOrZeroAddress(aaveOracleAddress)) {
        aaveOracle = await getAaveOracle(aaveOracleAddress);
        await waitForTx(await aaveOracle.setAssetSources(tokens, aggregators));
    } else {
        aaveOracle = await deployAaveOracle(
            [tokens, aggregators, fallbackOracleAddress, await getWethAddress(poolConfig)],
            verify
        ); 
    }

    // UNNECESSARY IN FINAL DEPLOYMENT: lendingRateOracle should be pre-determined & ownership transferred
    const lendingRateOracle = notFalsyOrZeroAddress(lendingRateOracleAddress)
    ? await getLendingRateOracle(lendingRateOracleAddress)
    : await deployLendingRateOracle(verify);

    const { USD, ...tokensAddressesWithoutUsd } = tokensToWatch;
    const borrowRates: string[] = [];
    for (const [assetSymbol, { borrowRate }] of Object.entries(lendingRateOracles) as [
        string,
        IMarketRates
    ][]) {
        borrowRates.push(borrowRate);
    }

    await waitForTx(await aaveOracle.transferOwnership(deployer.address));
    await waitForTx(await lendingRateOracle.transferOwnership(deployer.address));

    // Alternatively, to allow new markets to deploy autonomously, we can deploy individual oracles in the actual
    // full deployment contract for simplicity and to avoid ownership problems.

    const tx1 = await waitForTx(
        await deployer.deployOne({
            marketId: "testLP",
            poolAdmin: poolAdmin,
            emergencyAdmin: emergencyAdmin,
            lendingPoolImpl: lendingPoolImpl,
            lendingPoolConfiguratorImpl: lendingPoolConfiguratorImpl,
            aaveOracle: aaveOracle.address,
            rateOracle: lendingRateOracle.address,
            tokens: tokens,
            aggregators: aggregators,
            rates: borrowRates
        })
    );
    tx1.events?.forEach((event, index) => {
        addressesProvider = event?.args?.addressesProvider;
        lendingPool = event?.args?.lendingPool;
        lendingPoolConfigurator = event?.args?.lendingPoolConfigurator;
    });
    console.log("\nProvider address:", addressesProvider);
    console.log("Pool address:", lendingPool);
    console.log("Configurator address:", lendingPoolConfigurator);

    console.log("Tx1 gas used:", tx1.gasUsed.toString());
    console.log(`Finished full deployment`);

    // WIP
});
