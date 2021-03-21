// @ts-ignore
import { ethers, waffle } from 'hardhat'
import { Contract, Wallet, utils} from 'ethers'
import { MockProvider } from 'ethereum-waffle'
import { expect } from 'chai'
import WETH from '../artifacts/contracts/mocks/dependencies/weth/WETH9.sol/WETH9.json'
import GenericLogic from '../artifacts/contracts/protocol/libraries/logic/GenericLogic.sol/GenericLogic.json'
import ValidationLogic from '../artifacts/contracts/protocol/libraries/logic/ValidationLogic.sol/ValidationLogic.json'

const deployContract = waffle.deployContract
const link = waffle.link

interface AAVEFixture {
    genericLogic: Contract
    validationLogic: Contract

    lendingPool: Contract
    addressProvider: Contract

    oracle: Contract

    weth: Contract
}

async function aaveFixture([alice]: Wallet[], provider: MockProvider): Promise<AAVEFixture> {
    return <any> {
        weth: await deployContract(alice, WETH, [])
    }
}

describe('weth', () => {

    it('log', async () => {
        const wallets = await waffle.provider.getWallets()
        const [alice, bob, carol] = wallets
        
        const loader = await waffle.createFixtureLoader(wallets, waffle.provider)
        let fixture = await loader(aaveFixture)

        await fixture.weth.connect(alice).deposit({
            value: 1
        })
    })

})
