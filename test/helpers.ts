import {BigNumber, BigNumberish, Contract, providers, Wallet} from "ethers";
import {ContractJSON} from "ethereum-waffle/dist/esm/ContractJSON";
import AToken from "../artifacts/contracts/protocol/tokenization/AToken.sol/AToken.json";
import StableDebtToken from "../artifacts/contracts/protocol/tokenization/StableDebtToken.sol/StableDebtToken.json";
import VariableDebtToken
    from "../artifacts/contracts/protocol/tokenization/VariableDebtToken.sol/VariableDebtToken.json";
import DefaultReserveInterestRateStrategy
    from "../artifacts/contracts/protocol/lendingpool/DefaultReserveInterestRateStrategy.sol/DefaultReserveInterestRateStrategy.json";
import {MockProvider} from "ethereum-waffle";
import GenericLogic from "../artifacts/contracts/protocol/libraries/logic/GenericLogic.sol/GenericLogic.json";
import ValidationLogic from "../artifacts/contracts/protocol/libraries/logic/ValidationLogic.sol/ValidationLogic.json";
import {linkBytecode} from "./utils";
import ReserveLogic from "../artifacts/contracts/protocol/libraries/logic/ReserveLogic.sol/ReserveLogic.json";
import LendingPool from "../artifacts/contracts/protocol/lendingpool/LendingPool.sol/LendingPool.json";
import AddressProvider
    from "../artifacts/contracts/protocol/configuration/LendingPoolAddressesProvider.sol/LendingPoolAddressesProvider.json";
import Configurator
    from "../artifacts/contracts/protocol/lendingpool/LendingPoolConfigurator.sol/LendingPoolConfigurator.json";
import PriceOracle from "../artifacts/contracts/mocks/oracle/PriceOracle.sol/PriceOracle.json";
import LendingRateOracle from "../artifacts/contracts/mocks/oracle/LendingRateOracle.sol/LendingRateOracle.json";
import WETH from "../artifacts/contracts/mocks/dependencies/weth/WETH9.sol/WETH9.json";
import ERC20 from "../artifacts/contracts/mocks/tokens/MintableERC20.sol/MintableERC20.json";
import WETHGateway from "../artifacts/contracts/misc/WETHGateway.sol/WETHGateway.json";
import {waffle} from "hardhat";

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const HALF_RAY = BigNumber.from(10).pow(26).mul(5)
export const _1_ETH = BigNumber.from(1e10).mul(1e8)

export const overrides: providers.TransactionRequest = {
    gasPrice: 0,
}

export const deployContract = waffle.deployContract

export function weiToEther(n: BigNumber): number {
    return n.mul(1000).div(BigNumber.from(10).pow(18)).toNumber() / 1000
}

export interface AAVEFixture {
    genericLogic: Contract
    validationLogic: Contract
    reserveLogic: Contract

    configurator: Contract
    pool: Contract
    addressProvider: Contract

    priceOracle: Contract
    rateOracle: Contract

    weth: ReserveData
    aaa: ReserveData

    gateway: Contract
    collateralManager: Contract
}

export interface ReserveData {
    asset: Contract
    atoken: Contract
    stableDebt: Contract
    varDebt: Contract
    rateStrategy: Contract
}

async function initReserve(
    poolAdmin: Wallet,
    fixture: AAVEFixture,
    token: ContractJSON,
    args: any[],
    ltv: BigNumberish,
    liquidationThreshold: BigNumberish,
    liquidationBonus: BigNumberish,
    initialPrice: BigNumberish
): Promise<ReserveData> {
    let ret: ReserveData = <any>{
        asset: await deployContract(poolAdmin, token, args, overrides),
    }

    ret.atoken = await deployContract(poolAdmin, AToken, [], overrides)
    await ret.atoken.initialize(
        fixture.pool.address,
        ZERO_ADDRESS,
        ret.asset.address,
        ZERO_ADDRESS,
        await ret.asset.decimals(),
        'a' + await ret.asset.name(),
        'a' + await ret.asset.symbol(),
        '0x'
    )

    ret.stableDebt = await deployContract(poolAdmin, StableDebtToken, [], overrides)
    await ret.stableDebt.initialize(
        fixture.pool.address,
        ret.asset.address,
        ZERO_ADDRESS,
        await ret.asset.decimals(),
        'd' + await ret.asset.name(),
        'd' + await ret.asset.symbol(),
        '0x'
    )

    ret.varDebt = await deployContract(poolAdmin, VariableDebtToken, [], overrides)
    await ret.varDebt.initialize(
        fixture.pool.address,
        ret.asset.address,
        ZERO_ADDRESS,
        await ret.asset.decimals(),
        'd' + await ret.asset.name(),
        'd' + await ret.asset.symbol(),
        '0x'
    )

    ret.rateStrategy = await deployContract(poolAdmin, DefaultReserveInterestRateStrategy,
        [fixture.addressProvider.address, HALF_RAY, 0, 0, 0, 0, 0]
    )


    const o: Record<string, any> = {
        aTokenImpl: ret.atoken.address,
        stableDebtTokenImpl: ret.stableDebt.address,
        variableDebtTokenImpl: ret.varDebt.address,
        underlyingAssetDecimals: await ret.asset.decimals(),
        interestRateStrategyAddress: ret.rateStrategy.address,
        underlyingAsset: ret.asset.address,
        treasury: ZERO_ADDRESS,
        incentivesController: ZERO_ADDRESS,
        underlyingAssetName: await ret.asset.name(),
        aTokenName: await ret.atoken.name(),
        aTokenSymbol: await ret.atoken.symbol(),
        variableDebtTokenName: await ret.varDebt.name(),
        variableDebtTokenSymbol: await ret.varDebt.symbol(),
        stableDebtTokenName: await ret.stableDebt.name(),
        stableDebtTokenSymbol: await ret.stableDebt.symbol(),
        params: '0x'
    }

    // init reserve
    await fixture.configurator.batchInitReserve([
        o
    ])

    // init configuration
    await fixture.configurator.configureReserveAsCollateral(
        ret.asset.address,
        ltv,
        liquidationThreshold,
        liquidationBonus
    )

    // enable borrowing
    await fixture.configurator.enableBorrowingOnReserve(ret.asset.address, true)
    await fixture.priceOracle.setAssetPrice(ret.asset.address, initialPrice)

    const reverseData = await fixture.pool.getReserveData(ret.asset.address)
    ret.atoken = ret.atoken.attach(reverseData[7])
    ret.stableDebt = ret.stableDebt.attach(reverseData[8])
    ret.varDebt = ret.varDebt.attach(reverseData[9])
    return ret
}

export async function aaveFixture([alice, bob]: Wallet[], provider: MockProvider): Promise<AAVEFixture> {
    let ret: AAVEFixture = <any>{}
    // before all: linking
    ret.genericLogic = await deployContract(alice, GenericLogic, [], overrides)
    ValidationLogic.bytecode = linkBytecode(ValidationLogic, {GenericLogic: ret.genericLogic.address})
    ret.validationLogic = await deployContract(alice, ValidationLogic, [], overrides)
    ret.reserveLogic = await deployContract(alice, ReserveLogic, [], overrides)
    LendingPool.bytecode = linkBytecode(LendingPool, {
        ReserveLogic: ret.reserveLogic.address,
        ValidationLogic: ret.validationLogic.address
    })


    // 1. deploy address provider
    // set marketid = 0
    ret.addressProvider = await deployContract(alice, AddressProvider, [''], overrides)
    await ret.addressProvider.setPoolAdmin(alice.address, overrides)


    // 2. deploy lending pool
    ret.pool = await deployContract(alice, LendingPool, [], overrides)
    await ret.pool.initialize(ret.addressProvider.address, overrides)
    await ret.addressProvider.setLendingPoolImpl(ret.pool.address)

    // 3. deploy configurator
    ret.configurator = await deployContract(alice, Configurator, [], overrides)
    await ret.configurator.initialize(ret.addressProvider.address, overrides)
    await ret.addressProvider.setLendingPoolConfiguratorImpl(ret.configurator.address, overrides)

    // 4. deploy oracle
    ret.priceOracle = await deployContract(alice, PriceOracle, [], overrides)
    await ret.addressProvider.setPriceOracle(ret.priceOracle.address, overrides)
    ret.rateOracle = await deployContract(alice, LendingRateOracle, [], overrides)
    await ret.addressProvider.setLendingRateOracle(ret.rateOracle.address, overrides)

    // 5. initialize tokens
    ret.weth = await initReserve(alice, ret, WETH, [], 7000, 8000, 10500, _1_ETH)
    ret.aaa = await initReserve(alice, ret, ERC20, ['aaa', 'aaa', 18], 7000, 8000, 10500, _1_ETH)

    // 6. gateway
    ret.gateway = await deployContract(alice, WETHGateway, [ret.weth.asset.address], overrides)
    await ret.gateway.authorizeLendingPool(ret.pool.address, overrides)

    const aaaSupply = 1000000
    await ret.aaa.asset.mint(_1_ETH.mul(aaaSupply), overrides)

    // alice deposit 1000 eth
    await ret.gateway.connect(alice).depositETH(
        ret.pool.address,
        alice.address,
        0,
        {
            ...overrides,
            value: _1_ETH.mul(1000)
        }
    )


    // alice deposit all remained aaa
    await ret.aaa.asset.approve(ret.pool.address, _1_ETH.mul(aaaSupply - 200))
    await ret.pool.deposit(
        ret.aaa.asset.address,
        _1_ETH.mul(aaaSupply - 200),
        alice.address,
        0
    )

    // alice transfer 200 aa to bob
    await (<any>ret.aaa.asset.transfer)(bob.address, _1_ETH.mul(200), overrides)

    return ret
}

export enum InterestRateMode {NONE, STABLE, VARIABLE}

export interface UserData {
    totalCollateralETH: number,
    totalDebtETH: number,
    availableBorrowsETH: number,
    currentLiquidationThreshold: number,
    ltv: number,
    healthFactor: number
}

export async function getUserData(pool: Contract, userAddr: string): Promise<UserData> {
    const r: BigNumber[] = await pool.getUserAccountData(userAddr)
    const t = r[5].div(1e10)
    let h: string | number = t.gte(Number.MAX_SAFE_INTEGER - 1) ? Number.POSITIVE_INFINITY : t.toNumber() / 1e8

    return {
        totalCollateralETH: weiToEther(r[0]),
        totalDebtETH: weiToEther(r[1]),
        availableBorrowsETH: weiToEther(r[2]),
        currentLiquidationThreshold: r[3].toNumber() / 1e4,
        ltv: r[4].toNumber() / 1e4,
        healthFactor: h
    }

}