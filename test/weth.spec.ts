// @ts-ignore
import { ethers } from 'hardhat'


describe('weth', () => {

    it('log', async () => {
        const WETH = await ethers.getContractFactory('WETH9')
        const signers = await ethers.getSigners()
        const weth = await WETH.deploy()
        await weth.deposit({
            value: 1
        })
    })

})
