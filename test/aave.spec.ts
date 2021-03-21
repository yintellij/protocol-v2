// @ts-ignore
import {waffle} from 'hardhat'
import {utils} from 'ethers'
import {expect} from 'chai'
import {_1_ETH, aaveFixture, getUserData, InterestRateMode, overrides} from "./helpers";



describe('weth', () => {

    it('deposit borrow repay withdraw', async () => {
        const [alice, bob, carol] = await waffle.provider.getWallets()
        const loader = await waffle.createFixtureLoader([alice, bob], waffle.provider)
        let fixture = await loader(aaveFixture)

        // 1. bob deposit 50 eth and 50 aaa
        await fixture.gateway.connect(bob).depositETH(fixture.pool.address, bob.address, 0, {
            ...overrides,
            value: _1_ETH.mul(50)
        })

        await fixture.aaa.asset.connect(bob).approve(fixture.pool.address, _1_ETH.mul(50))
        await fixture.pool.connect(bob).deposit(
            fixture.aaa.asset.address,
            _1_ETH.mul(50),
            bob.address,
            0
        )

        // 2. bob borrow 70 eth
        await fixture.weth.stableDebt.connect(bob).approveDelegation(
            fixture.gateway.address,
            _1_ETH.mul(70)
        )

        await fixture.gateway.connect(bob).borrowETH(
            fixture.pool.address,
            _1_ETH.mul(70),
            InterestRateMode.STABLE,
            0
        )

        // try to withdraw 12.5 eth, health factor = 1
        await fixture.weth.atoken.connect(bob).approve(fixture.gateway.address, utils.parseEther('12.5'))
        await fixture.gateway.connect(bob).withdrawETH(
            fixture.pool.address,
            utils.parseEther('12.5'),
            bob.address
        )


        // try to withdraw 1eth
        await fixture.weth.atoken.connect(bob).approve(fixture.gateway.address, utils.parseEther('1'))
        await expect(fixture.gateway.connect(bob).withdrawETH(
            fixture.pool.address,
            utils.parseEther('1'),
            bob.address
        )).to.be.revertedWith('6')

        // set aaa price as 0.9, this will decrease bob's health factor
        await fixture.priceOracle
            .connect(alice)
            .setAssetPrice(fixture.aaa.asset.address, utils.parseEther('0.9'))

        expect((await getUserData(fixture.pool, bob.address)).healthFactor).to.lessThan(1)
    })

})
