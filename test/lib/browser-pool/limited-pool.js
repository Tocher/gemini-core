'use strict';

const Promise = require('bluebird');
const LimitedPool = require('lib/browser-pool/limited-pool');
const CancelledError = require('lib/errors/cancelled-error');
const stubBrowser = require('./util').stubBrowser;

describe('browser-pool/limited-pool', () => {
    const sandbox = sinon.sandbox.create();
    let underlyingPool;

    const makePool_ = (limit) => new LimitedPool(underlyingPool, {limit: limit || 1, logNamespace: 'gemini'});

    beforeEach(() => {
        underlyingPool = {
            getBrowser: sinon.stub().callsFake((id) => Promise.resolve(stubBrowser(id))),
            freeBrowser: sinon.stub().returns(Promise.resolve()),
            cancel: sinon.stub()
        };
    });

    afterEach(() => sandbox.restore());

    describe('getBrowser', () => {
        it('should request browser from underlying pool', async () => {
            const browser = stubBrowser('bro');
            underlyingPool.getBrowser.returns(Promise.resolve(browser));

            const bro = await makePool_().getBrowser('bro');

            assert.equal(bro, browser);
        });

        it('should pass opts to underlying pool', async () => {
            const browser = stubBrowser('bro');
            underlyingPool.getBrowser.returns(Promise.resolve(browser));

            await makePool_().getBrowser('bro', {some: 'opt'});

            assert.calledOnceWith(underlyingPool.getBrowser, 'bro', {some: 'opt'});
        });
    });

    describe('should return browser to underlying pool', () => {
        let browser;
        let pool;

        beforeEach(() => {
            browser = stubBrowser();
            pool = makePool_();
            underlyingPool.getBrowser.returns(Promise.resolve(browser));
        });

        it('when freed', () => {
            return pool.freeBrowser(browser)
                .then(() => assert.calledWith(underlyingPool.freeBrowser, browser));
        });

        it('for release if there are no more requests', () => {
            return pool.getBrowser('first')
                .then(() => pool.freeBrowser(browser))
                .then(() => assert.calledWith(underlyingPool.freeBrowser, browser, {force: true}));
        });

        it('for caching if there is at least one pending request', () => {
            return pool.getBrowser('first')
                .then(() => {
                    pool.getBrowser('second');
                    return pool.freeBrowser(browser);
                })
                .then(() => assert.calledWith(underlyingPool.freeBrowser, browser, {force: false}));
        });

        it('for release if there are pending requests but forced to free', () => {
            return pool.getBrowser('first')
                .then(() => {
                    pool.getBrowser('second');
                    return pool.freeBrowser(browser, {force: true});
                })
                .then(() => assert.calledWith(underlyingPool.freeBrowser, browser, {force: true}));
        });

        it('for caching if there are pending requests', () => {
            return pool.getBrowser('first')
                .then(() => {
                    pool.getBrowser('second');
                    pool.getBrowser('third');
                    return pool.freeBrowser(browser);
                })
                .then(() => assert.calledWith(underlyingPool.freeBrowser, browser, {force: false}));
        });

        it('taking into account number of failed browser requests', () => {
            const browser = stubBrowser();
            const pool = makePool_(2);

            underlyingPool.getBrowser
                .withArgs('first').returns(Promise.resolve(browser))
                .withArgs('second').returns(Promise.reject());

            return Promise
                .all([
                    pool.getBrowser('first'),
                    pool.getBrowser('second').reflect()
                ])
                .then(() => pool.freeBrowser(browser))
                .then(() => assert.calledWith(underlyingPool.freeBrowser, browser, {force: true}));
        });
    });

    it('should launch next request from queue on fail to receive browser from underlying pool', () => {
        const browser = stubBrowser();
        const pool = makePool_();

        underlyingPool.getBrowser.onFirstCall().returns(Promise.reject());
        underlyingPool.getBrowser.onSecondCall().returns(Promise.resolve(browser));

        pool.getBrowser('bro').catch(() => {});

        assert.eventually.equal(pool.getBrowser('bro'), browser);
    });

    describe('limit', () => {
        it('should launch all browser in limit', () => {
            underlyingPool.getBrowser
                .withArgs('first').returns(Promise.resolve(stubBrowser()))
                .withArgs('second').returns(Promise.resolve(stubBrowser()));
            const pool = makePool_(2);

            return Promise.all([pool.getBrowser('first'), pool.getBrowser('second')])
                .then(() => {
                    assert.calledTwice(underlyingPool.getBrowser);
                    assert.calledWith(underlyingPool.getBrowser, 'first');
                    assert.calledWith(underlyingPool.getBrowser, 'second');
                });
        });

        it('should not launch browsers out of limit', () => {
            underlyingPool.getBrowser.returns(Promise.resolve(stubBrowser()));
            const pool = makePool_(1);

            const result = pool.getBrowser('first')
                .then(() => pool.getBrowser('second').timeout(100, 'timeout'));

            return assert.isRejected(result, /timeout$/);
        });

        it('should launch next browser after previous is released', () => {
            const expectedBrowser = stubBrowser();
            const pool = makePool_(1);

            underlyingPool.getBrowser
                .withArgs('first').returns(Promise.resolve(stubBrowser()))
                .withArgs('second').returns(Promise.resolve(expectedBrowser));

            const result = pool.getBrowser('first')
                .then((browser) => pool.freeBrowser(browser))
                .then(() => pool.getBrowser('second'));

            return assert.eventually.equal(result, expectedBrowser);
        });

        it('should launch queued browser when previous is released', () => {
            const expectedBrowser = stubBrowser();
            const pool = makePool_(1);

            underlyingPool.getBrowser
                .withArgs('first').returns(Promise.resolve(stubBrowser()))
                .withArgs('second').returns(Promise.resolve(expectedBrowser));

            const result = pool.getBrowser('first')
                .then((browser) => {
                    const secondPromise = pool.getBrowser('second');
                    return Promise.delay(100)
                        .then(() => pool.freeBrowser(browser))
                        .then(() => secondPromise);
                });

            return assert.eventually.equal(result, expectedBrowser);
        });

        it('should perform high priority request first', async () => {
            const firstBrowserRequest = underlyingPool.getBrowser.withArgs('first').named('firstRequest');
            const secondBrowserRequest = underlyingPool.getBrowser.withArgs('second').named('secondRequest');
            const thirdBrowserRequest = underlyingPool.getBrowser.withArgs('third').named('thirdRequest');

            const pool = makePool_(1);
            const free_ = (bro) => pool.freeBrowser(bro);

            await Promise.all([
                pool.getBrowser('first').then(free_),
                pool.getBrowser('second').then(free_),
                pool.getBrowser('third', {highPriority: true}).then(free_)
            ]);

            assert.callOrder(
                firstBrowserRequest,
                thirdBrowserRequest,
                secondBrowserRequest
            );
        });

        it('should launch next browsers if free failed', () => {
            const expectedBrowser = stubBrowser();
            const pool = makePool_(1);

            underlyingPool.getBrowser
                .withArgs('first').returns(Promise.resolve(stubBrowser()))
                .withArgs('second').returns(Promise.resolve(expectedBrowser));

            underlyingPool.freeBrowser.callsFake(() => Promise.reject());

            return pool.getBrowser('first')
                .then((browser) => {
                    const secondPromise = pool.getBrowser('second');
                    return Promise.delay(100)
                        .then(() => pool.freeBrowser(browser))
                        .catch(() => secondPromise);
                })
                .then((browser) => assert.equal(browser, expectedBrowser));
        });

        it('should not wait for queued browser to start after release browser', () => {
            const pool = makePool_(1);
            const afterFree = sinon.spy().named('afterFree');
            const afterSecondGet = sinon.spy().named('afterSecondGet');

            underlyingPool.getBrowser
                .withArgs('first').returns(Promise.resolve(stubBrowser()))
                .withArgs('second').returns(Promise.resolve());

            return pool.getBrowser('first')
                .then((browser) => {
                    const freeFirstBrowser = Promise.delay(100)
                        .then(() => pool.freeBrowser(browser))
                        .then(afterFree);

                    const getSecondBrowser = pool.getBrowser('second')
                        .then(afterSecondGet);

                    return Promise.all([getSecondBrowser, freeFirstBrowser])
                        .then(() => assert.callOrder(afterFree, afterSecondGet));
                });
        });

        it('should reject the queued call when underlying pool rejects the request', () => {
            const pool = makePool_(1);
            const error = new Error('You shall not pass');
            underlyingPool.getBrowser
                .onSecondCall().callsFake(() => Promise.reject(error));

            return pool.getBrowser('bro')
                .then((browser) => {
                    const secondRequest = pool.getBrowser('bro');
                    return pool.freeBrowser(browser)
                        .then(() => assert.isRejected(secondRequest, error));
                });
        });
    });

    describe('cancel', () => {
        it('should cancel queued browsers', async () => {
            const pool = makePool_(1);

            const firstRequest = pool.getBrowser('bro').then((bro) => {
                pool.cancel();
                return pool.freeBrowser(bro);
            });
            const secondRequest = pool.getBrowser('bro');
            const thirdRequest = pool.getBrowser('bro', {highPriority: true});

            await Promise.all([firstRequest, secondRequest, thirdRequest]).catch(() => {});

            await assert.isRejected(secondRequest, CancelledError);
            await assert.isRejected(thirdRequest, CancelledError);
        });

        it('should cancel an underlying pool', () => {
            const pool = makePool_(1);

            pool.cancel();

            assert.calledOnce(underlyingPool.cancel);
        });

        it('should reset request queue', async () => {
            const pool = makePool_(1);
            const free_ = (bro) => pool.freeBrowser(bro);

            await Promise.all([
                pool.getBrowser('first').then((bro) => {
                    pool.cancel();
                    return free_(bro);
                }),
                pool.getBrowser('second').then(free_),
                pool.getBrowser('third', {highPriority: true}).then(free_)
            ])
            .catch(() => {});

            assert.calledOnce(underlyingPool.getBrowser);
            assert.neverCalledWith(underlyingPool.getBrowser, 'second');
            assert.neverCalledWith(underlyingPool.getBrowser, 'third');
        });
    });
});
