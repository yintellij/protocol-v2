// @ts-ignore
import { ethers, waffle } from 'hardhat'
import {Contract, Wallet, utils, BigNumber, providers, BigNumberish} from 'ethers'
import { MockProvider } from 'ethereum-waffle'
import { linkBytecode } from './utils'
import type { ContractJSON } from "ethereum-waffle/dist/esm/ContractJSON";

import { expect } from 'chai'
import WETH from '../artifacts/contracts/mocks/dependencies/weth/WETH9.sol/WETH9.json'
import GenericLogic from '../artifacts/contracts/protocol/libraries/logic/GenericLogic.sol/GenericLogic.json'
import ValidationLogic from '../artifacts/contracts/protocol/libraries/logic/ValidationLogic.sol/ValidationLogic.json'
import AddressProvider from '../artifacts/contracts/protocol/configuration/LendingPoolAddressesProvider.sol/LendingPoolAddressesProvider.json'
import Configurator from '../artifacts/contracts/protocol/lendingpool/LendingPoolConfigurator.sol/LendingPoolConfigurator.json'
import LendingPool from '../artifacts/contracts/protocol/lendingpool/LendingPool.sol/LendingPool.json'
import ReserveLogic from '../artifacts/contracts/protocol/libraries/logic/ReserveLogic.sol/ReserveLogic.json'
import PriceOracle from '../artifacts/contracts/mocks/oracle/PriceOracle.sol/PriceOracle.json'
import AToken from '../artifacts/contracts/protocol/tokenization/AToken.sol/AToken.json'
import StableDebtToken from '../artifacts/contracts/protocol/tokenization/StableDebtToken.sol/StableDebtToken.json'
import VariableDebtToken from '../artifacts/contracts/protocol/tokenization/VariableDebtToken.sol/VariableDebtToken.json'
import DefaultReserveInterestRateStrategy from '../artifacts/contracts/protocol/lendingpool/DefaultReserveInterestRateStrategy.sol/DefaultReserveInterestRateStrategy.json'
import WETHGateway from '../artifacts/contracts/misc/WETHGateway.sol/WETHGateway.json'
import LendingRateOracle from '../artifacts/contracts/mocks/oracle/LendingRateOracle.sol/LendingRateOracle.json'
import ERC20 from '../artifacts/contracts/mocks/tokens/MintableERC20.sol/MintableERC20.json'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const HALF_RAY = BigNumber.from(10).pow(26).mul(5)

const deployContract = waffle.deployContract
const _1_ETH = BigNumber.from(1e10).mul(1e8)

const overrides: providers.TransactionRequest = {
    gasPrice: 0,
}

enum InterestRateMode {NONE, STABLE, VARIABLE}

export function weiToEther(n: BigNumber): number{
    return n.mul(1000).div(BigNumber.from(10).pow(18)).toNumber() / 1000
}

export async function logUser(pool: Contract, userAddr: string): Promise<void> {
    const r: BigNumber[] = await pool.getUserAccountData(userAddr)
    const t = r[5].div(1e10)
    let h: string | number = t.gte(Number.MAX_SAFE_INTEGER - 1) ? '+infinity' : t.toNumber() / 1e8

    console.log({
        totalCollateralETH: weiToEther(r[0]),
        totalDebtETH: weiToEther(r[1]),
        availableBorrowsETH: weiToEther(r[2]),
        currentLiquidationThreshold:  r[3].toNumber() / 1e4,
        ltv: r[4].toNumber() / 1e4,
        healthFactor: h
    })
}

interface AAVEFixture {
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
}

interface ReserveData{
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
    let ret : ReserveData = <any> {
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

async function aaveFixture([admin]: Wallet[], provider: MockProvider): Promise<AAVEFixture> {
    let ret: AAVEFixture = <any> {}
    // before all: linking
    ret.genericLogic = await deployContract(admin, GenericLogic, [], overrides)
    ValidationLogic.bytecode = linkBytecode(ValidationLogic, {GenericLogic: ret.genericLogic.address})
    ret.validationLogic = await deployContract(admin, ValidationLogic, [], overrides)
    ret.reserveLogic = await deployContract(admin, ReserveLogic, [], overrides)
    LendingPool.bytecode = linkBytecode(LendingPool, {
        ReserveLogic: ret.reserveLogic.address,
        ValidationLogic: ret.validationLogic.address
    })


    // 1. deploy address provider
    // set marketid = 0
    ret.addressProvider = await deployContract(admin, AddressProvider, [''], overrides)
    await ret.addressProvider.setPoolAdmin(admin.address, overrides)


    // 2. deploy lending pool
    ret.pool = await deployContract(admin, LendingPool, [], overrides)
    await ret.pool.initialize(ret.addressProvider.address, overrides)
    await ret.addressProvider.setLendingPoolImpl(ret.pool.address)

    // 3. deploy configurator
    ret.configurator = await deployContract(admin, Configurator, [], overrides)
    await ret.configurator.initialize(ret.addressProvider.address, overrides)
    await ret.addressProvider.setLendingPoolConfiguratorImpl(ret.configurator.address, overrides)

    // 4. deploy oracle
    ret.priceOracle = await deployContract(admin, PriceOracle, [], overrides)
    await ret.addressProvider.setPriceOracle(ret.priceOracle.address, overrides)
    ret.rateOracle = await deployContract(admin, LendingRateOracle, [], overrides)
    await ret.addressProvider.setLendingRateOracle(ret.rateOracle.address, overrides)

    // 5. initialize tokens
    ret.weth = await initReserve(admin, ret, WETH, [], 7000, 7500, 10500, _1_ETH)
    ret.aaa = await initReserve(admin, ret, ERC20, ['aaa', 'aaa', 18], 7000, 7500, 10500, _1_ETH)

    // 6. gateway
    ret.gateway = await deployContract(admin, WETHGateway, [ret.weth.asset.address], overrides)
    await ret.gateway.authorizeLendingPool(ret.pool.address, overrides)

    return ret
}

describe('weth', () => {

    it('deposit borrow repay withdraw', async () => {
        const [admin, bob] = await waffle.provider.getWallets()
        const loader = await waffle.createFixtureLoader([admin], waffle.provider)
        let fixture = await loader(aaveFixture)

        const aaaSupply = 1000000

        await fixture.aaa.asset.mint(_1_ETH.mul(aaaSupply), overrides)

        // admin deposit 1000 eth
        await fixture.gateway.connect(admin).depositETH(
            fixture.pool.address,
            admin.address,
            0,
            {
                ...overrides,
                value: _1_ETH.mul(1000)
            }
        )


        // admin deposit all remained aaa
        await fixture.aaa.asset.approve(fixture.pool.address, _1_ETH.mul(aaaSupply - 200))
        await fixture.pool.deposit(
            fixture.aaa.asset.address,
            _1_ETH.mul(aaaSupply - 200),
            admin.address,
            0
        )

        // admin transfer 200 aa to bob
        await (<any>fixture.aaa.asset.transfer)(bob.address, _1_ETH.mul(200), overrides)

        // 1. bob deposit 10 eth
        await fixture.gateway.connect(bob).depositETH(fixture.pool.address, bob.address, 0, {
            ...overrides,
            value: _1_ETH.mul(10)
        })


        // log user
        console.log('bob = ' + bob.address)
        console.log('gateway = ' + fixture.gateway.address)

        // 2. bob borrow 6 eth
        await fixture.weth.stableDebt.connect(bob).approveDelegation(
            fixture.gateway.address,
            _1_ETH.mul(6)
        )

        await fixture.gateway.connect(bob).borrowETH(
            fixture.pool.address,
            _1_ETH.mul(6),
            InterestRateMode.STABLE,
            0
        )

        // withdraw all
        await fixture.weth.atoken.connect(bob).approve(fixture.gateway.address, _1_ETH.mul(10))
        await fixture.gateway.connect(bob).withdrawETH(
            fixture.pool.address,
            _1_ETH.mul(10),
            bob.address
        )
    })

})
