'use strict';

const Rect = require('lib/browser/client-scripts/rect').Rect;

describe('Rect', () => {
    describe('constructor', () => {
        it('should create instance using width/height properties', () => {
            assert.doesNotThrow(() => {
                return new Rect({
                    top: 10,
                    left: 20,
                    width: 100,
                    height: 100
                });
            });
        });

        it('should create instance using bottom/right properties', () => {
            assert.doesNotThrow(() => {
                return new Rect({
                    top: 10,
                    left: 20,
                    bottom: 100,
                    right: 100
                });
            });
        });

        it('should fail when there are no bottom/right or width/height properties', () => {
            assert.throws(() => {
                return new Rect({top: 10, left: 20});
            });
        });
    });

    describe('rectInside', () => {
        const rect = new Rect({
            top: 10,
            left: 20,
            width: 100,
            height: 100
        });

        it('should return true when rect is inside', () => {
            assert.isTrue(rect.rectInside(
                new Rect({
                    top: rect.top + 10,
                    left: rect.left + 10,
                    width: rect.width - 50,
                    height: rect.height - 50
                })
            ));
        });

        it('should return false when rect is not inside', () => {
            assert.isFalse(rect.rectInside(
                new Rect({
                    top: rect.top - 5,
                    left: rect.left - 5,
                    width: rect.width,
                    height: rect.width
                })
            ));
        });
    });
});
