// @ts-ignore
import { ethers, waffle } from 'hardhat'
import { Contract, Wallet, utils } from 'ethers'
import { MockProvider } from 'ethereum-waffle'
import type { providers } from "ethers";
import { linkBytecode } from './utils'

import { expect } from 'chai'
import WETH from '../artifacts/contracts/mocks/dependencies/weth/WETH9.sol/WETH9.json'
import GenericLogic from '../artifacts/contracts/protocol/libraries/logic/GenericLogic.sol/GenericLogic.json'
import ValidationLogic from '../artifacts/contracts/protocol/libraries/logic/ValidationLogic.sol/ValidationLogic.json'
import AddressProvider from '../artifacts/contracts/protocol/configuration/LendingPoolAddressesProvider.sol/LendingPoolAddressesProvider.json'
import Configurator from '../artifacts/contracts/protocol/lendingpool/LendingPoolConfigurator.sol/LendingPoolConfigurator.json'
import LendingPool from '../artifacts/contracts/protocol/lendingpool/LendingPool.sol/LendingPool.json'
import ReserveLogic from '../artifacts/contracts/protocol/libraries/logic/ReserveLogic.sol/ReserveLogic.json'

const deployContract = waffle.deployContract
const link = waffle.link

const overrides: providers.TransactionRequest = {
    gasPrice: 0
}

interface AAVEFixture {
    genericLogic: Contract
    validationLogic: Contract
    reserveLogic: Contract

    configurator: Contract
    pool: Contract
    addressProvider: Contract

    oracle: Contract

    weth: Contract
}

async function aaveFixture([alice]: Wallet[], provider: MockProvider): Promise<AAVEFixture> {
    let ret: AAVEFixture = <any> {}
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
    // set alice as pool admin
    ret.addressProvider = await deployContract(alice, AddressProvider, [0], overrides)
    await ret.addressProvider.setPoolAdmin(alice.address, overrides)

    // 2. deploy configurator
    ret.configurator = await deployContract(alice, Configurator, [], overrides)
    await ret.configurator.initialize(ret.addressProvider.address, overrides)
    await ret.addressProvider.setLendingPoolConfiguratorImpl(ret.configurator.address, overrides)

    // 3. deploy lendingpool
    ret.pool = await deployContract(alice, LendingPool, [], overrides)
    await ret.pool.initialize(ret.addressProvider.address, overrides)

    return ret
}

describe('weth', () => {

    it('log', async () => {
        const wallets = await waffle.provider.getWallets()
        const [alice, bob, carol] = wallets

        const loader = await waffle.createFixtureLoader(wallets, waffle.provider)
        let fixture = await loader(aaveFixture)

        console.log(await fixture.pool.LENDINGPOOL_REVISION())
    })

})
