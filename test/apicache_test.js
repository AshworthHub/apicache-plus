/* eslint-disable no-unused-expressions */
var chai = require('chai')
var expect = chai.expect
var request = require('supertest')
var pkg = require('../package.json')
var movies = require('./api/lib/data.json')
var redis = require('ioredis-mock')
var apicache = require('../src/apicache')
// node-redis usage
redis.createClient = function(options) {
  if (options.prefix) options.keyPrefix = options.prefix
  var client = new this(options)
  // patch append to work with buffers and add missing getrangeBuffer
  var multi = client.multi()
  client.multi = function() {
    return multi
  }
  var multiAppend = multi.append.bind(multi)
  multi.append = function(key, value) {
    if (!Buffer.isBuffer(value)) return multiAppend(key, value)

    var memo = client.data.get(key) || Buffer.alloc(0)
    value = Buffer.from(value, 'utf8') // ioredis-mock stores buffers as utf-8
    client.data.set(key, Buffer.concat([memo, value]))
  }
  client.getrangeBuffer = client.getrange
  return client
}

var apis = [
  { name: 'express', server: require('./api/express') },
  { name: 'express+gzip', server: require('./api/express-gzip') },
  { name: 'restify', server: require('./api/restify') },
  { name: 'restify+gzip', server: require('./api/restify-gzip') },
]

function assertNumRequestsProcessed(app, n) {
  return function() {
    expect(app.requestsProcessed).to.equal(n)
  }
}

describe('.options(opt?) {GETTER/SETTER}', function() {
  var apicache = require('../src/apicache')

  it('is a function', function() {
    expect(typeof apicache.options).to.equal('function')
  })

  describe('.options() {GETTER}', function() {
    it('returns global options as object', function() {
      expect(typeof apicache.options()).to.equal('object')
    })
  })

  describe('.options(opt) {SETTER}', function() {
    it('is chainable', function() {
      expect(apicache.options({})).to.equal(apicache)
    })

    it('extends defaults', function() {
      expect(apicache.options({ foo: 'bar' }).options().foo).to.equal('bar')
    })

    it('allows overrides of defaults', function() {
      var newDuration = 11

      expect(apicache.options()).to.have.property('defaultDuration')
      expect(apicache.options({ defaultDuration: newDuration }).options().defaultDuration).to.equal(
        newDuration
      )
    })
  })
})

describe('.getDuration(stringOrNumber) {GETTER}', function() {
  var apicache = require('../src/apicache')

  it('is a function', function() {
    expect(typeof apicache.getDuration).to.equal('function')
  })

  it('returns value unchanged if numeric', function() {
    expect(apicache.getDuration(77)).to.equal(77)
  })

  it('returns default duration when uncertain', function() {
    apicache.options({ defaultDuration: 999 })
    expect(apicache.getDuration(undefined)).to.equal(999)
  })

  it('accepts singular or plural (e.g. "1 hour", "3 hours")', function() {
    expect(apicache.getDuration('3 seconds')).to.equal(3000)
    expect(apicache.getDuration('3 second')).to.equal(3000)
  })

  it('accepts decimals (e.g. "1.5 hours")', function() {
    expect(apicache.getDuration('1.5 seconds')).to.equal(1500)
  })

  describe('unit support', function() {
    it('numeric values as milliseconds', function() {
      expect(apicache.getDuration(43)).to.equal(43)
    })
    it('milliseconds', function() {
      expect(apicache.getDuration('3 ms')).to.equal(3)
    })
    it('seconds', function() {
      expect(apicache.getDuration('3 seconds')).to.equal(3000)
    })
    it('minutes', function() {
      expect(apicache.getDuration('4 minutes')).to.equal(1000 * 60 * 4)
    })
    it('hours', function() {
      expect(apicache.getDuration('2 hours')).to.equal(1000 * 60 * 60 * 2)
    })
    it('days', function() {
      expect(apicache.getDuration('3 days')).to.equal(1000 * 60 * 60 * 24 * 3)
    })
    it('weeks', function() {
      expect(apicache.getDuration('5 weeks')).to.equal(1000 * 60 * 60 * 24 * 7 * 5)
    })
    it('months', function() {
      expect(apicache.getDuration('6 months')).to.equal(1000 * 60 * 60 * 24 * 30 * 6)
    })
  })
})

describe('.getPerformance()', function() {
  var apicache = require('../src/apicache')

  it('is a function', function() {
    expect(typeof apicache.getPerformance).to.equal('function')
  })

  it('returns an array', function() {
    expect(Array.isArray(apicache.getPerformance())).to.be.true
  })

  it('returns a null hit rate if the api has not been called', function() {
    var api = require('./api/express')
    var app = api.create('10 seconds', { trackPerformance: true })
    expect(app.apicache.getPerformance()[0]).to.deep.equal({
      callCount: 0,
      hitCount: 0,
      missCount: 0,
      hitRate: null,
      hitRateLast100: null,
      hitRateLast1000: null,
      hitRateLast10000: null,
      hitRateLast100000: null,
      lastCacheHit: null,
      lastCacheMiss: null,
    })
  })

  it('returns a 0 hit rate if the api has been called once', function() {
    var api = require('./api/express')
    var app = api.create('10 seconds', { trackPerformance: true })

    return request(app)
      .get('/api/movies')
      .then(function(res) {
        expect(app.apicache.getPerformance()[0]).to.deep.equal({
          callCount: 1,
          hitCount: 0,
          missCount: 1,
          hitRate: 0,
          hitRateLast100: 0,
          hitRateLast1000: 0,
          hitRateLast10000: 0,
          hitRateLast100000: 0,
          lastCacheHit: null,
          lastCacheMiss: '/api/movies',
        })
      })
  })

  it('returns a 0.5 hit rate if the api has been called twice', function() {
    var api = require('./api/express')
    var app = api.create('10 seconds', { trackPerformance: true })
    var requests = []
    for (var i = 0; i < 2; i++) {
      requests.push(request(app).get('/api/movies'))
    }
    return Promise.all(requests).then(function(res) {
      expect(app.apicache.getPerformance()[0]).to.deep.equal({
        callCount: 2,
        hitCount: 1,
        missCount: 1,
        hitRate: 0.5,
        hitRateLast100: 0.5,
        hitRateLast1000: 0.5,
        hitRateLast10000: 0.5,
        hitRateLast100000: 0.5,
        lastCacheHit: '/api/movies',
        lastCacheMiss: '/api/movies',
      })
    })
  })
})

describe('.getIndex([groupName]) {GETTER}', function() {
  var apicache = require('../src/apicache')

  it('is a function', function() {
    expect(typeof apicache.getIndex).to.equal('function')
  })

  it('returns an object', function() {
    expect(typeof apicache.getIndex()).to.equal('object')
  })

  it('can clear indexed cache groups', function() {
    var api = require('./api/express')
    var app = api.create('10 seconds')

    return request(app)
      .get('/api/testcachegroup')
      .then(function(res) {
        expect(app.apicache.getIndex('cachegroup').length).to.equal(1)
      })
  })
})

describe('.resetIndex() {SETTER}', function() {
  var apicache = require('../src/apicache')

  it('is a function', function() {
    expect(typeof apicache.resetIndex).to.equal('function')
  })
})

describe('.middleware {MIDDLEWARE}', function() {
  it('is a function', function() {
    var apicache = require('../src/apicache')
    expect(typeof apicache.middleware).to.equal('function')
    expect(apicache.middleware.length).to.equal(3)
  })

  it('returns the middleware function', function() {
    var middleware = require('../src/apicache').middleware('10 seconds')
    expect(typeof middleware).to.equal('function')
    expect(middleware.length).to.equal(3)
  })

  describe('options', function() {
    var apicache = require('../src/apicache').newInstance()

    it('uses global options if local ones not provided', function() {
      apicache.options({
        appendKey: ['test'],
      })
      var middleware1 = apicache.middleware('10 seconds')
      var middleware2 = apicache.middleware('20 seconds')
      expect(middleware1.options()).to.eql({
        debug: false,
        defaultDuration: 3600000,
        enabled: true,
        appendKey: ['test'],
        jsonp: false,
        redisClient: false,
        redisPrefix: '',
        headerBlacklist: [],
        statusCodes: { include: [], exclude: [] },
        events: { expire: undefined },
        headers: {},
        trackPerformance: false,
      })
      expect(middleware2.options()).to.eql({
        debug: false,
        defaultDuration: 3600000,
        enabled: true,
        appendKey: ['test'],
        jsonp: false,
        redisClient: false,
        redisPrefix: '',
        headerBlacklist: [],
        statusCodes: { include: [], exclude: [] },
        events: { expire: undefined },
        headers: {},
        trackPerformance: false,
      })
    })

    it('uses local options if they provided', function() {
      apicache.options({
        appendKey: ['test'],
      })
      var middleware1 = apicache.middleware('10 seconds', null, {
        debug: true,
        defaultDuration: 7200000,
        appendKey: ['bar'],
        statusCodes: { include: [], exclude: ['400'] },
        events: { expire: undefined },
        headers: {
          'cache-control': 'no-cache',
        },
      })
      var middleware2 = apicache.middleware('20 seconds', null, {
        debug: false,
        defaultDuration: 1800000,
        appendKey: ['foo'],
        statusCodes: { include: [], exclude: ['200'] },
        events: { expire: undefined },
      })
      expect(middleware1.options()).to.eql({
        debug: true,
        defaultDuration: 7200000,
        enabled: true,
        appendKey: ['bar'],
        jsonp: false,
        redisClient: false,
        redisPrefix: '',
        headerBlacklist: [],
        statusCodes: { include: [], exclude: ['400'] },
        events: { expire: undefined },
        headers: {
          'cache-control': 'no-cache',
        },
        trackPerformance: false,
      })
      expect(middleware2.options()).to.eql({
        debug: false,
        defaultDuration: 1800000,
        enabled: true,
        appendKey: ['foo'],
        jsonp: false,
        redisClient: false,
        redisPrefix: '',
        headerBlacklist: [],
        statusCodes: { include: [], exclude: ['200'] },
        events: { expire: undefined },
        headers: {},
        trackPerformance: false,
      })
    })

    it('updates options if global ones changed', function() {
      apicache.options({
        debug: true,
        appendKey: ['test'],
      })
      var middleware1 = apicache.middleware('10 seconds', null, {
        defaultDuration: 7200000,
        statusCodes: { include: [], exclude: ['400'] },
      })
      var middleware2 = apicache.middleware('20 seconds', null, {
        defaultDuration: 1800000,
        statusCodes: { include: [], exclude: ['200'] },
      })
      apicache.options({
        debug: false,
        appendKey: ['foo'],
      })
      expect(middleware1.options()).to.eql({
        debug: false,
        defaultDuration: 7200000,
        enabled: true,
        appendKey: ['foo'],
        jsonp: false,
        redisClient: false,
        redisPrefix: '',
        headerBlacklist: [],
        statusCodes: { include: [], exclude: ['400'] },
        events: { expire: undefined },
        headers: {},
        trackPerformance: false,
      })
      expect(middleware2.options()).to.eql({
        debug: false,
        defaultDuration: 1800000,
        enabled: true,
        appendKey: ['foo'],
        jsonp: false,
        redisClient: false,
        redisPrefix: '',
        headerBlacklist: [],
        statusCodes: { include: [], exclude: ['200'] },
        events: { expire: undefined },
        headers: {},
        trackPerformance: false,
      })
    })

    it('updates options if local ones changed', function() {
      apicache.options({
        debug: true,
        appendKey: ['test'],
      })
      var middleware1 = apicache.middleware('10 seconds', null, {
        defaultDuration: 7200000,
        statusCodes: { include: [], exclude: ['400'] },
      })
      var middleware2 = apicache.middleware('20 seconds', null, {
        defaultDuration: 900000,
        statusCodes: { include: [], exclude: ['404'] },
      })
      middleware1.options({
        debug: false,
        defaultDuration: 1800000,
        appendKey: ['foo'],
        headers: {
          'cache-control': 'no-cache',
        },
      })
      middleware2.options({
        defaultDuration: 450000,
        enabled: false,
        appendKey: ['foo'],
      })
      expect(middleware1.options()).to.eql({
        debug: false,
        defaultDuration: 1800000,
        enabled: true,
        appendKey: ['foo'],
        jsonp: false,
        redisClient: false,
        redisPrefix: '',
        headerBlacklist: [],
        statusCodes: { include: [], exclude: [] },
        events: { expire: undefined },
        headers: {
          'cache-control': 'no-cache',
        },
        trackPerformance: false,
      })
      expect(middleware2.options()).to.eql({
        debug: true,
        defaultDuration: 450000,
        enabled: false,
        appendKey: ['foo'],
        jsonp: false,
        redisClient: false,
        redisPrefix: '',
        headerBlacklist: [],
        statusCodes: { include: [], exclude: [] },
        events: { expire: undefined },
        headers: {},
        trackPerformance: false,
      })
    })
  })

  apis.forEach(function(api) {
    describe(api.name + ' tests', function() {
      var mockAPI = api.server

      it('does not interfere with initial request', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/movies')
          .expect(200)
          .then(assertNumRequestsProcessed(app, 1))
      })

      it('properly returns a request while caching (first call)', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/movies')
          .expect(200, movies)
          .then(assertNumRequestsProcessed(app, 1))
      })

      it('returns max-age header on first request', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/movies')
          .expect(200, movies)
          .expect('Cache-Control', /max-age/)
      })

      it('returns properly decremented max-age header on cached response', function(done) {
        var app = mockAPI.create('10 seconds')

        request(app)
          .get('/api/movies')
          .expect(200, movies)
          .expect('Cache-Control', 'max-age=10, must-revalidate')
          .then(function(res) {
            setTimeout(function() {
              request(app)
                .get('/api/movies')
                .expect(200, movies)
                .expect('Cache-Control', 'max-age=9, must-revalidate')
                .then(function() {
                  expect(app.requestsProcessed).to.equal(1)
                  done()
                })
                .catch(function(err) {
                  done(err)
                })
            }, 500)
          })
      })

      it('returns decremented max-age header when overwritten one is higher than cache duration', function(done) {
        var app = mockAPI.create('10 seconds', { headers: { 'cache-control': 'max-age=15' } })

        request(app)
          .get('/api/movies')
          .expect(200, movies)
          .expect('Cache-Control', 'max-age=15')
          .then(function(res) {
            setTimeout(function() {
              request(app)
                .get('/api/movies')
                .expect(200, movies)
                .expect('Cache-Control', 'max-age=9')
                .then(function() {
                  expect(app.requestsProcessed).to.equal(1)
                  done()
                })
                .catch(function(err) {
                  done(err)
                })
            }, 500)
          })
      })

      it('returns overwritten max-age header when lower than cache duration', function(done) {
        var app = mockAPI.create('10 seconds', { headers: { 'cache-control': 'max-age=5' } })

        request(app)
          .get('/api/movies')
          .expect(200, movies)
          .expect('Cache-Control', 'max-age=5')
          .then(function(res) {
            setTimeout(function() {
              request(app)
                .get('/api/movies')
                .expect(200, movies)
                .expect('Cache-Control', 'max-age=5')
                .then(function() {
                  expect(app.requestsProcessed).to.equal(1)
                  done()
                })
                .catch(function(err) {
                  done(err)
                })
            }, 500)
          })
      })

      it('skips cache when using header "x-apicache-bypass"', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/movies')
          .expect(200, movies)
          .then(assertNumRequestsProcessed(app, 1))
          .then(function() {
            return request(app)
              .get('/api/movies')
              .set('x-apicache-bypass', true)
              .set('Accept', 'application/json')
              .expect('Content-Type', /json/)
              .expect(200, movies)
              .then(function(res) {
                expect(res.headers['apicache-store']).to.be.undefined
                expect(res.headers['apicache-version']).to.be.undefined
                expect(app.requestsProcessed).to.equal(2)
              })
          })
      })

      it('skips cache when using header "x-apicache-force-fetch (legacy)"', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/movies')
          .expect(200, movies)
          .then(assertNumRequestsProcessed(app, 1))
          .then(function() {
            return request(app)
              .get('/api/movies')
              .set('x-apicache-force-fetch', true)
              .set('Accept', 'application/json')
              .expect('Content-Type', /json/)
              .expect(200, movies)
              .then(function(res) {
                expect(res.headers['apicache-store']).to.be.undefined
                expect(res.headers['apicache-version']).to.be.undefined
                expect(app.requestsProcessed).to.equal(2)
              })
          })
      })

      it('does not cache header in headerBlacklist', function() {
        var app = mockAPI.create('10 seconds', { headerBlacklist: ['x-blacklisted'] })

        return request(app)
          .get('/api/testheaderblacklist')
          .expect(200, movies)
          .then(function(res) {
            expect(res.headers['x-blacklisted']).to.equal(res.headers['x-notblacklisted'])
            return request(app)
              .get('/api/testheaderblacklist')
              .set('Accept', 'application/json')
              .expect('Content-Type', /json/)
              .expect(200, movies)
              .then(function(res2) {
                expect(res2.headers['x-blacklisted']).to.not.equal(res2.headers['x-notblacklisted'])
              })
          })
      })

      it('properly returns a cached JSON request', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/movies')
          .expect(200, movies)
          .then(assertNumRequestsProcessed(app, 1))
          .then(function() {
            return request(app)
              .get('/api/movies')
              .set('Accept', 'application/json')
              .expect('Content-Type', /json/)
              .expect(200, movies)
              .then(assertNumRequestsProcessed(app, 1))
          })
      })

      it('properly uses appendKey params', function() {
        var app = mockAPI.create('10 seconds', { appendKey: ['method'] })

        return request(app)
          .get('/api/movies')
          .expect(200, movies)
          .then(function() {
            expect(app.apicache.getIndex().all[0]).to.equal('/api/movies$$appendKey=GET')
          })
      })

      it('properly uses custom appendKey(req, res) function', function() {
        var appendKey = function(req, res) {
          return req.method + res.id
        }
        var app = mockAPI.create('10 seconds', { appendKey: appendKey })

        return request(app)
          .get('/api/movies')
          .expect(200, movies)
          .then(function() {
            expect(app.apicache.getIndex().all[0]).to.equal('/api/movies$$appendKey=GET123')
          })
      })

      it('returns cached response from write+end', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/writeandend')
          .expect(200, 'abc')
          .expect('Cache-Control', 'max-age=10, must-revalidate')
          .then(assertNumRequestsProcessed(app, 1))
          .then(function() {
            return request(app)
              .get('/api/writeandend')
              .expect(200, 'abc')
              .then(assertNumRequestsProcessed(app, 1))
          })
      })

      it('returns cached response from write Buffer+end', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/writebufferandend')
          .expect(200, 'abc')
          .expect('Cache-Control', 'max-age=10, must-revalidate')
          .then(assertNumRequestsProcessed(app, 1))
          .then(function() {
            return request(app)
              .get('/api/writebufferandend')
              .expect(200, 'abc')
              .then(assertNumRequestsProcessed(app, 1))
          })
      })

      it('embeds store type and apicache version in cached responses', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/movies')
          .expect(200, movies)
          .then(function(res) {
            expect(res.headers['apicache-store']).to.be.undefined
            expect(res.headers['apicache-version']).to.be.undefined
            expect(app.requestsProcessed).to.equal(1)
          })
          .then(function() {
            return request(app)
              .get('/api/movies')
              .expect('apicache-store', 'memory')
              .expect('apicache-version', pkg.version)
              .expect(200, movies)
              .then(assertNumRequestsProcessed(app, 1))
          })
      })

      it('does NOT store type and apicache version in cached responses when NODE_ENV === "production"', function() {
        var app = mockAPI.create('10 seconds')
        process.env.NODE_ENV = 'production'

        return request(app)
          .get('/api/movies')
          .expect(200, movies)
          .then(function(res) {
            expect(res.headers['apicache-store']).to.be.undefined
            expect(res.headers['apicache-version']).to.be.undefined
            expect(app.requestsProcessed).to.equal(1)
          })
          .then(function() {
            return request(app)
              .get('/api/movies')
              .expect(200, movies)
              .then(function(res) {
                expect(res.headers['apicache-store']).to.be.undefined
                expect(res.headers['apicache-version']).to.be.undefined
                expect(app.requestsProcessed).to.equal(1)

                process.env.NODE_ENV = undefined
              })
          })
      })

      it('embeds cache-control header', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/movies')
          .expect('Cache-Control', 'max-age=10, must-revalidate')
          .expect(200, movies)
          .then(function(res) {
            expect(res.headers['apicache-store']).to.be.undefined
            expect(res.headers['apicache-version']).to.be.undefined
            expect(app.requestsProcessed).to.equal(1)
            expect(res.headers.date).to.exist
          })
          .then(function() {
            return request(app)
              .get('/api/movies')
              .expect('apicache-store', 'memory')
              .expect('apicache-version', pkg.version)
              .expect(200, movies)
              .then(assertNumRequestsProcessed(app, 1))
          })
      })

      it('allows cache-control header to be overwritten (e.g. "no-cache"', function() {
        var app = mockAPI.create('10 seconds', { headers: { 'cache-control': 'no-cache' } })

        return request(app)
          .get('/api/movies')
          .expect('Cache-Control', 'no-cache')
          .expect(200, movies)
          .then(function(res) {
            expect(res.headers['apicache-store']).to.be.undefined
            expect(res.headers['apicache-version']).to.be.undefined
            expect(app.requestsProcessed).to.equal(1)
            expect(res.headers.date).to.exist
          })
          .then(function() {
            return request(app)
              .get('/api/movies')
              .expect('Cache-Control', 'no-cache')
              .expect('apicache-store', 'memory')
              .expect('apicache-version', pkg.version)
              .expect(200, movies)
              .then(assertNumRequestsProcessed(app, 1))
          })
      })

      it('allows cache-control header to be overwritten by local options', function() {
        var globalOptions = { headers: { 'cache-control': 'no-cache' } }
        var localOptions = { headers: { 'cache-control': 'no-store' } }
        var app = mockAPI.create('10 seconds', globalOptions, null, localOptions)

        return request(app)
          .get('/api/movies')
          .expect('Cache-Control', 'no-store')
          .expect(200, movies)
          .then(function(res) {
            expect(res.headers['apicache-store']).to.be.undefined
            expect(res.headers['apicache-version']).to.be.undefined
            expect(app.requestsProcessed).to.equal(1)
            expect(res.headers['date']).to.exist
          })
          .then(function() {
            return request(app)
              .get('/api/movies')
              .expect('Cache-Control', 'no-store')
              .expect('apicache-store', 'memory')
              .expect('apicache-version', pkg.version)
              .expect(200, movies)
              .then(assertNumRequestsProcessed(app, 1))
          })
      })

      it('preserves etag header', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/movies')
          .expect(200)
          .then(function(res) {
            var etag = res.headers.etag
            expect(etag).to.exist
            return etag
          })
          .then(function(etag) {
            return request(app)
              .get('/api/movies')
              .expect(200)
              .expect('etag', etag)
          })
      })

      it('respects if-none-match header', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/movies')
          .expect(200, movies)
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
            expect(res.headers['last-modified']).to.be.undefined
            return res.headers.etag
          })
          .then(function(etag) {
            return request(app)
              .get('/api/movies')
              .set('if-none-match', etag)
              .expect(304, '')
              .expect('etag', etag)
          })
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
          })
      })

      it('respects if-modified-since header', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/ifmodifiedsince')
          .expect(200, 'hi')
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
            expect(res.headers.etag).to.be.undefined
            return res.headers['last-modified']
          })
          .then(function(lastModified) {
            return request(app)
              .get('/api/ifmodifiedsince')
              .set('if-modified-since', lastModified)
              .expect(304, '')
              .expect('last-modified', lastModified)
          })
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
          })
      })

      it("don't send 304 if set if-unmodified-since header", function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/ifmodifiedsince')
          .expect(200, 'hi')
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
            expect(res.headers.etag).to.be.undefined
            return res.headers['last-modified']
          })
          .then(function(lastModified) {
            return request(app)
              .get('/api/ifmodifiedsince')
              .set('if-unmodified-since', new Date().toUTCString())
              .set('if-modified-since', lastModified)
              .expect(200, 'hi')
              .expect('last-modified', lastModified)
          })
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
          })
      })

      it('support end-to-end reload requests', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/ifmodifiedsince')
          .expect(200, 'hi')
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
            expect(res.headers.etag).to.be.undefined
            return res.headers['last-modified']
          })
          .then(function(lastModified) {
            return request(app)
              .get('/api/ifmodifiedsince')
              .set('cache-control', 'no-cache')
              .set('if-modified-since', lastModified)
              .expect(200, 'hi')
              .expect('last-modified', lastModified)
          })
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
          })
      })

      it('send empty body for HEAD requests', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/movies')
          .expect(200, movies)
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
            return request(app)
              .head('/api/movies')
              .expect(200, undefined)
              .then(function(cachedRes) {
                expect(res.headers['content-type']).to.exist
                expect(res.headers['content-type']).to.eql(cachedRes.headers['content-type'])
                expect(app.requestsProcessed).to.equal(1)
              })
          })
      })

      it('embeds returns content-type JSON from original response and cached response', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/movies')
          .expect(200)
          .expect('Content-Type', 'application/json; charset=utf-8')
          .then(function() {
            return request(app)
              .get('/api/movies')
              .expect('Content-Type', 'application/json; charset=utf-8')
          })
      })

      it('does not cache a request when status code found in status code exclusions', function() {
        var app = mockAPI.create('2 seconds', {
          statusCodes: { exclude: [404] },
        })

        return request(app)
          .get('/api/missing')
          .expect(404)
          .then(function(res) {
            expect(res.headers['cache-control']).to.equal('no-store')
            expect(app.apicache.getIndex().all.length).to.equal(0)
          })
      })

      it('does not cache a request when status code not found in status code inclusions', function() {
        var app = mockAPI.create('2 seconds', {
          statusCodes: { include: [200] },
        })

        return request(app)
          .get('/api/missing')
          .expect(404)
          .then(function(res) {
            expect(res.headers['cache-control']).to.equal('no-store')
            expect(app.apicache.getIndex().all.length).to.equal(0)
          })
      })

      it('middlewareToggle does not block response on falsy middlewareToggle', function() {
        var hits = 0

        var onlyOnce = function(req, res) {
          return hits++ === 0
        }

        var app = mockAPI.create('2 seconds', {}, onlyOnce)

        return request(app)
          .get('/api/movies')
          .then(function(res) {
            return request(app)
              .get('/api/movies')
              .expect(200, movies)
              .then(function(res) {
                expect(res.headers['apicache-version']).to.be.undefined
              })
          })
      })

      it('middlewareToggle works correctly to control statusCode caching (per example)', function() {
        var onlyStatusCode200 = function(req, res) {
          return res.statusCode === 200
        }

        var app = mockAPI.create('2 seconds', {}, onlyStatusCode200)

        return request(app)
          .get('/api/missing')
          .expect(404)
          .then(function(res) {
            expect(res.headers['cache-control']).to.equal('no-store')
            expect(app.apicache.getIndex().all.length).to.equal(0)
          })
      })

      it('removes a cache key after expiration', function(done) {
        var app = mockAPI.create(10)

        request(app)
          .get('/api/movies')
          .end(function(_err, res) {
            expect(app.apicache.getIndex().all.length).to.equal(1)
            expect(app.apicache.getIndex().all).to.include('/api/movies')
          })

        setTimeout(function() {
          expect(app.apicache.getIndex().all).to.have.length(0)
          done()
        }, 30)
      })

      it('executes expiration callback from globalOptions.events.expire upon entry expiration', function(done) {
        var callbackResponse
        var cb = function(a, b) {
          callbackResponse = b
        }
        var app = mockAPI.create(15, { events: { expire: cb } })

        request(app)
          .get('/api/movies')
          .end(function(_err, res) {
            expect(app.apicache.getIndex().all.length).to.equal(1)
            expect(app.apicache.getIndex().all).to.include('/api/movies')
          })

        setTimeout(function() {
          expect(app.apicache.getIndex().all).to.have.length(0)
          expect(callbackResponse).to.equal('/api/movies')
          done()
        }, 35)
      })

      it('clearing cache cancels expiration callback', function(done) {
        var app = mockAPI.create(30)

        request(app)
          .get('/api/movies')
          .end(function(_err, res) {
            expect(app.apicache.getIndex().all.length).to.equal(1)
            expect(app.apicache.clear('/api/movies').all.length).to.equal(0)
            expect(app.requestsProcessed).to.equal(1)
          })

        setTimeout(function() {
          request(app)
            .get('/api/movies')
            .end(function(_err, res) {
              expect(app.apicache.getIndex().all.length).to.equal(1)
              expect(app.apicache.getIndex().all).to.include('/api/movies')
              expect(app.requestsProcessed).to.equal(2)
            })
        }, 15)

        setTimeout(function() {
          expect(app.apicache.getIndex().all.length).to.equal(1)
          expect(app.apicache.getIndex().all).to.include('/api/movies')
          done()
        }, 35)
      })

      it('allows defaultDuration to be a parseable string (e.g. "1 week")', function(done) {
        var callbackResponse
        var cb = function(a, b) {
          callbackResponse = b
        }
        var app = mockAPI.create(null, { defaultDuration: '10ms', events: { expire: cb } })

        request(app)
          .get('/api/movies')
          .end(function(_err, res) {
            expect(app.apicache.getIndex().all.length).to.equal(1)
            expect(app.apicache.getIndex().all).to.include('/api/movies')
          })

        setTimeout(function() {
          expect(app.apicache.getIndex().all).to.have.length(0)
          expect(callbackResponse).to.equal('/api/movies')
          done()
        }, 30)
      })

      describe('can attach many apicache middlewares to same route', function() {
        beforeEach(function() {
          var cache = apicache.newInstance({ enabled: true }).middleware
          this.app = mockAPI.create(null, { enabled: false })
          this.skippingMiddleware = cache('2 seconds', function(req) {
            return req.path !== '/sameroute'
          })
          this.regularMiddleware = cache('2 seconds', function(req) {
            return req.path === '/sameroute'
          })
          this.otherRegularMiddleware = cache('2 seconds', null)
          this.responseBody = { i: 'am' }
          this.respond = function(_req, res) {
            this.app.requestsProcessed++
            res.json(this.responseBody)
          }.bind(this)
        })

        it('starting with a bypass toggle', function() {
          var that = this
          this.app.get(
            '/sameroute',
            this.otherRegularMiddleware,
            this.regularMiddleware,
            // this is starting one cause of patched res functions gets called at reverse order
            this.skippingMiddleware,
            this.respond
          )

          request(this.app)
            .get('/sameroute')
            .expect(200, this.responseBody)
            .then(function() {
              expect(that.app.requestsProcessed).to.equal(1)
              return request(that.app)
                .get('/sameroute')
                .expect(200, that.responseBody)
            })
            .then(function() {
              expect(that.app.requestsProcessed).to.equal(1)
            })
        })

        it('not starting with a bypass toggle', function() {
          var that = this
          this.app.get(
            '/sameroute',
            this.otherRegularMiddleware,
            this.skippingMiddleware,
            this.regularMiddleware,
            this.respond
          )

          request(this.app)
            .get('/sameroute')
            .expect(200, this.responseBody)
            .then(function() {
              expect(that.app.requestsProcessed).to.equal(1)
              return request(that.app)
                .get('/sameroute')
                .expect(200, that.responseBody)
            })
            .then(function() {
              expect(that.app.requestsProcessed).to.equal(1)
            })
        })

        it('ending with a bypass toggle', function() {
          var that = this
          this.app.get(
            '/sameroute',
            this.skippingMiddleware,
            this.regularMiddleware,
            this.otherRegularMiddleware,
            this.respond
          )

          request(this.app)
            .get('/sameroute')
            .expect(200, this.responseBody)
            .then(function() {
              expect(that.app.requestsProcessed).to.equal(1)
              return request(that.app)
                .get('/sameroute')
                .expect(200, that.responseBody)
            })
            .then(function() {
              expect(that.app.requestsProcessed).to.equal(1)
            })
        })
      })
    })
  })
})

var compressionApis = [apis[1], apis[3]]
compressionApis.forEach(function(api) {
  describe(api.name + ' compression tests', function() {
    var db = redis.createClient({ prefix: 'a-prefix:' })
    var mockAPI = api.server
    var configs = [
      {
        clientName: 'memory',
        config: {},
      },
      {
        clientName: 'redis',
        config: { redisClient: db, redisPrefix: 'a-prefix:' },
      },
    ]

    configs.forEach(function(meta) {
      describe('with ' + meta.clientName + ' cache', function() {
        if (meta.clientName === 'redis') {
          // eslint-disable-next-line no-undef
          afterEach(function(done) {
            db.flushdb(done)
          })
        }

        it('can send compressed cache', function() {
          var app = mockAPI.create('10 seconds', meta.config)

          return request(app)
            .get('/api/movies')
            .set('Accept-Encoding', 'deflate, gzip')
            .expect('Content-Encoding', 'gzip')
            .expect(200, movies)
            .then(function() {
              expect(app.requestsProcessed).to.equal(1)
            })
            .then(function() {
              return request(app)
                .get('/api/movies')
                .set('Accept-Encoding', '*')
                .expect('Content-Encoding', 'gzip')
                .expect(200, movies)
            })
            .then(function() {
              expect(app.requestsProcessed).to.equal(1)
            })
        })

        it('respect cache-control no-transform value', function() {
          var app = mockAPI.create('10 seconds', meta.config)

          return request(app)
            .get('/api/notransform')
            .set('Accept-Encoding', 'deflate, gzip')
            .expect(200, 'hi')
            .then(function() {
              expect(app.requestsProcessed).to.equal(1)
            })
            .then(function() {
              return request(app)
                .get('/api/notransform')
                .set('Accept-Encoding', '*')
                .expect(200, 'hi')
            })
            .then(function(res) {
              expect(res.headers['content-encoding'] || 'identity').to.equal('identity')
              expect(app.requestsProcessed).to.equal(1)
            })
        })

        it('can use cache with compression mismatch', function() {
          var app = mockAPI.create('10 seconds', meta.config)

          return request(app)
            .get('/api/movies')
            .set('Accept-Encoding', 'deflate, gzip')
            .expect('Content-Encoding', 'gzip')
            .expect(200, movies)
            .then(function() {
              expect(app.requestsProcessed).to.equal(1)
            })
            .then(function() {
              return request(app)
                .get('/api/movies')
                .set('Accept-Encoding', 'br')
                .expect('Content-Encoding', 'identity')
                .expect(200, movies)
            })
            .then(function() {
              expect(app.requestsProcessed).to.equal(1)
            })
        })

        it('can use compressed cache for uncompressed request', function() {
          var app = mockAPI.create('10 seconds', meta.config)
          var encoding = api.name === 'restify+gzip' ? 'gzip' : 'deflate'

          return request(app)
            .get('/api/movies')
            .set('Accept-Encoding', encoding)
            .expect('Content-Encoding', encoding)
            .expect(200, movies)
            .then(function() {
              expect(app.requestsProcessed).to.equal(1)
            })
            .then(function() {
              return request(app)
                .get('/api/movies')
                .set('Accept-Encoding', '')
                .expect('Content-Encoding', 'identity')
                .expect(200, movies)
            })
            .then(function() {
              expect(app.requestsProcessed).to.equal(1)
            })
        })

        it('can use compressed cache for unknown encoding request', function() {
          var app = mockAPI.create('10 seconds', meta.config)

          return request(app)
            .get('/api/movies')
            .set('Accept-Encoding', 'gzip')
            .expect('Content-Encoding', 'gzip')
            .expect(200, movies)
            .then(function() {
              expect(app.requestsProcessed).to.equal(1)
            })
            .then(function() {
              return request(app)
                .get('/api/movies')
                .set('Accept-Encoding', 'unknown')
                .expect('Content-Encoding', 'identity')
                .expect(200, movies)
            })
            .then(function() {
              expect(app.requestsProcessed).to.equal(1)
            })
        })

        it("won't compress with unknown encoding request", function() {
          var app = mockAPI.create('10 seconds', meta.config)

          return request(app)
            .get('/api/movies')
            .set('Accept-Encoding', 'unknown')
            .expect(200, movies)
            .then(function() {
              expect(app.requestsProcessed).to.equal(1)
            })
            .then(function() {
              return request(app)
                .get('/api/movies')
                .set('Accept-Encoding', 'gzip')
                .expect(200, movies)
            })
            .then(function(res) {
              expect(res.headers['content-encoding'] || 'identity').to.equal('identity')
              expect(app.requestsProcessed).to.equal(1)
            })
        })
      })
    })
  })
})

describe('Redis support', function() {
  function hgetallIsNull(db, key) {
    return new Promise(function(resolve, reject) {
      db.hgetall(key, function(err, reply) {
        if (err) {
          reject(err)
        } else {
          // null when node-redis. {} when ioredis
          expect(reply || {}).to.eql({})
          db.flushdb()
          resolve()
        }
      })
    })
  }

  apis.forEach(function(api) {
    describe(api.name + ' tests', function() {
      this.timeout(3000)
      var mockAPI = api.server

      it('properly caches a request', function() {
        var db = redis.createClient({ prefix: 'a-prefix:' })
        var app = mockAPI.create('10 seconds', { redisClient: db, redisPrefix: 'a-prefix:' })

        return request(app)
          .get('/api/movies')
          .expect(200, movies)
          .then(function(res) {
            expect(res.headers['apicache-store']).to.be.undefined
            expect(res.headers['apicache-version']).to.be.undefined
            expect(app.requestsProcessed).to.equal(1)
          })
          .then(function() {
            return request(app)
              .get('/api/movies')
              .expect(200, movies)
              .expect('apicache-store', 'redis')
              .expect('apicache-version', pkg.version)
              .then(assertNumRequestsProcessed(app, 1))
              .then(function() {
                db.flushdb()
              })
          })
      })

      it('can clear indexed cache groups', function() {
        var db = redis.createClient({ prefix: 'a-prefix:' })
        var app = mockAPI.create('10 seconds', { redisClient: db, redisPrefix: 'a-prefix:' })

        return request(app)
          .get('/api/testcachegroup')
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
            return new Promise(function(resolve) {
              setTimeout(function() {
                resolve(app.apicache.getIndex())
              }, 10)
            })
          })
          .then(function(index) {
            expect(index.all.length).to.equal(1)
            expect(index.groups.cachegroup.length).to.equal(1)
            return app.apicache.clear('cachegroup').then(function() {
              return app.apicache.getIndex()
            })
          })
          .then(function(index) {
            expect(Object.keys(index.groups).length).to.equal(0)
            expect(index.all.length).to.equal(0)
            return hgetallIsNull(db, '/api/testcachegroup')
          })
      })

      it('can clear indexed entries by url/key (non-group)', function() {
        var db = redis.createClient({ prefix: 'a-prefix:' })
        var app = mockAPI.create('10 seconds', { redisClient: db, redisPrefix: 'a-prefix:' })

        return request(app)
          .get('/api/testcachegroup')
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
            return new Promise(function(resolve) {
              setTimeout(function() {
                resolve(app.apicache.getIndex())
              }, 10)
            })
          })
          .then(function(index) {
            expect(index.all.length).to.equal(1)
            expect(Object.keys(index.groups).length).to.equal(1)
            return app.apicache.clear('/api/testcachegroup').then(function() {
              return app.apicache.getIndex()
            })
          })
          .then(function(index) {
            expect(index.all.length).to.equal(0)
            expect(Object.keys(index.groups).length).to.equal(0)
            return hgetallIsNull(db, '/api/movies')
          })
      })

      it('can clear all entries from index', function() {
        var db = redis.createClient({ prefix: 'a-prefix:' })
        var app = mockAPI.create('10 seconds', { redisClient: db, redisPrefix: 'a-prefix:' })

        return app.apicache
          .getIndex()
          .then(function(index) {
            expect(index.all.length).to.equal(0)
            return app.apicache.clear().then(function() {
              return new Promise(function(resolve) {
                setImmediate(function() {
                  resolve(app.apicache.getIndex())
                })
              }).then(function(index) {
                expect(index.all.length).to.equal(0)
              })
            })
          })
          .then(function() {
            return request(app).get('/api/testcachegroup')
          })
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
            return new Promise(function(resolve) {
              setTimeout(function() {
                resolve(app.apicache.getIndex())
              }, 10)
            })
          })
          .then(function(index) {
            expect(index.all.length).to.equal(1)
            expect(Object.keys(index.groups).length).to.equal(1)
            return app.apicache.clear().then(function() {
              return app.apicache.getIndex()
            })
          })
          .then(function(index) {
            expect(index.all.length).to.equal(0)
            expect(Object.keys(index.groups).length).to.equal(0)
            return hgetallIsNull(db, '/api/movies')
          })
      })

      it('can share cache between instances', function() {
        var db = redis.createClient({ prefix: 'a-prefix:' })
        var app = mockAPI.create('10 seconds', { redisClient: db, redisPrefix: 'a-prefix:' })
        var otherApp

        return request(app)
          .get('/api/testcachegroup')
          .then(function() {
            otherApp = mockAPI.create('10 seconds', { redisClient: db, redisPrefix: 'a-prefix:' })
            return new Promise(function(resolve) {
              setTimeout(function() {
                resolve(Promise.all([app.apicache.getIndex(), otherApp.apicache.getIndex()]))
              }, 10)
            })
          })
          .then(function(indexes) {
            indexes.forEach(function(index) {
              expect(index.all.length).to.equal(1)
              expect(index.groups.cachegroup.length).to.equal(1)
            })
            return otherApp.apicache.clear('cachegroup')
          })
          .then(function() {
            return Promise.all([app.apicache.getIndex(), otherApp.apicache.getIndex()])
          })
          .then(function(indexes) {
            indexes.forEach(function(index) {
              expect(index.all.length).to.equal(0)
              expect((index.groups.cachegroup || []).length).to.equal(0)
            })
            return hgetallIsNull(db, '/api/testcachegroup')
          })
      })

      it('can download data even if key gets deleted in the middle of it', function() {
        var db = redis.createClient({ prefix: 'a-prefix:' })
        var app = mockAPI.create('1 minute', { redisClient: db, redisPrefix: 'a-prefix:' })

        var then = Date.now()
        return request(app)
          .get('/api/bigresponse')
          .expect(200)
          .then(function(res) {
            var resTime = Date.now() - then
            expect(app.requestsProcessed).to.equal(1)
            expect(res.text.slice(0, 5)).to.equal('aaaaa')
            then = Date.now()
            return new Promise(function(resolve) {
              setTimeout(function() {
                var promiseAll = Promise.all([
                  request(app)
                    .get('/api/bigresponse')
                    .then(function(otherRes) {
                      return [Date.now() - then, otherRes]
                    }),
                  new Promise(function(resolve) {
                    return setTimeout(function() {
                      app.apicache.clear('/api/bigresponse').then(function(deleteCount) {
                        resolve([Date.now() - then, deleteCount])
                      })
                    }, resTime / 10)
                  }),
                ])
                resolve(promiseAll)
              }, 10)
            })
              .then(function(promiseAllReturn) {
                var elapsedTime1 = promiseAllReturn[0][0]
                var elapsedTime2 = promiseAllReturn[1][0]
                expect(elapsedTime2).to.be.below(elapsedTime1)
                return [promiseAllReturn[0][1], promiseAllReturn[1][1]]
              })
              .then(function(otherResAndDeleteCount) {
                var cachedRes = otherResAndDeleteCount[0]
                var deleteCount = otherResAndDeleteCount[1]
                expect(cachedRes.text).to.equal(res.text)
                expect(deleteCount).to.equal(2)
                return app.apicache.getIndex()
              })
          })
          .then(function(index) {
            expect(app.requestsProcessed).to.equal(1)
            expect(index.all.length).to.equal(0)
            expect(Object.keys(index.groups).length).to.equal(0)
          })
          .then(function() {
            return new Promise(function(resolve) {
              db.flushdb(resolve)
            })
          })
      })

      it('can download data even if key group gets deleted in the middle of it', function() {
        var db = redis.createClient({ prefix: 'a-prefix:' })
        var app = mockAPI.create('1 minute', { redisClient: db, redisPrefix: 'a-prefix:' })

        var then = Date.now()
        return request(app)
          .get('/api/bigresponse')
          .expect(200)
          .then(function(res) {
            var resTime = Date.now() - then
            expect(app.requestsProcessed).to.equal(1)
            expect(res.text.slice(0, 5)).to.equal('aaaaa')
            then = Date.now()
            return new Promise(function(resolve) {
              setTimeout(function() {
                var promiseAll = Promise.all([
                  request(app)
                    .get('/api/bigresponse')
                    .then(function(otherRes) {
                      return [Date.now() - then, otherRes]
                    }),
                  new Promise(function(resolve) {
                    return setTimeout(function() {
                      app.apicache.clear('bigresponsegroup').then(function(deleteCount) {
                        resolve([Date.now() - then, deleteCount])
                      })
                    }, resTime / 10)
                  }),
                ])
                resolve(promiseAll)
              }, 10)
            })
              .then(function(promiseAllReturn) {
                var elapsedTime1 = promiseAllReturn[0][0]
                var elapsedTime2 = promiseAllReturn[1][0]
                expect(elapsedTime2).to.be.below(elapsedTime1)
                return [promiseAllReturn[0][1], promiseAllReturn[1][1]]
              })
              .then(function(otherResAndDeleteCount) {
                var cachedRes = otherResAndDeleteCount[0]
                var deleteCount = otherResAndDeleteCount[1]
                expect(cachedRes.text).to.equal(res.text)
                expect(deleteCount).to.equal(2)
                return app.apicache.getIndex()
              })
          })
          .then(function(index) {
            expect(app.requestsProcessed).to.equal(1)
            expect(index.all.length).to.equal(0)
            expect(Object.keys(index.groups).length).to.equal(0)
          })
          .then(function() {
            return new Promise(function(resolve) {
              db.flushdb(resolve)
            })
          })
      })

      it("won't append response to same key twice", function() {
        var db = redis.createClient({ prefix: 'a-prefix:' })
        var app = mockAPI.create('1 minute', { redisClient: db, redisPrefix: 'a-prefix:' })

        return Promise.all([
          request(app).get('/api/slowresponse'),
          request(app).get('/api/slowresponse'),
        ])
          .then(function(res) {
            expect(res[0].text).to.equal(res[1].text)
            expect(res[0].text).to.equal('hello world')
            expect(app.requestsProcessed).to.equal(2)
            return new Promise(function(resolve) {
              setTimeout(function() {
                resolve(app.apicache.getIndex())
              }, 10)
            })
          })
          .then(function(index) {
            expect(index.all.length).to.equal(1)
            expect(index.all[0]).to.equal('/api/slowresponse')
            return request(app).get('/api/slowresponse')
          })
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(2)
            expect(res.text).to.equal('hello world')
          })
          .then(function() {
            return new Promise(function(resolve) {
              db.flushdb(resolve)
            })
          })
      })

      it('sends a response even upon redis failure', function() {
        var app = mockAPI.create('10 seconds', { redisClient: {} })

        return request(app)
          .get('/api/movies')
          .expect(200, movies)
      })
    })
  })
})

describe('.clear(key?) {SETTER}', function() {
  it('is a function', function() {
    var apicache = require('../src/apicache')
    expect(typeof apicache.clear).to.equal('function')
  })

  apis.forEach(function(api) {
    describe(api.name + ' tests', function() {
      var mockAPI = api.server

      it('works when called with group key', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/testcachegroup')
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
            expect(app.apicache.getIndex().all.length).to.equal(1)
            expect(app.apicache.getIndex().groups.cachegroup.length).to.equal(1)
            expect(Object.keys(app.apicache.clear('cachegroup').groups).length).to.equal(0)
            expect(app.apicache.getIndex().all.length).to.equal(0)
          })
      })

      it('works when called with specific endpoint (non-group) key', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/movies')
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
            expect(app.apicache.getIndex().all.length).to.equal(1)
            expect(app.apicache.clear('/api/movies').all.length).to.equal(0)
          })
      })

      it('clears empty group after removing last specific endpoint', function() {
        var app = mockAPI.create('10 seconds')

        return request(app)
          .get('/api/testcachegroup')
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
            expect(app.apicache.getIndex().all.length).to.equal(1)
            expect(app.apicache.getIndex().groups.cachegroup.length).to.equal(1)
            expect(Object.keys(app.apicache.clear('/api/testcachegroup').groups).length).to.equal(0)
            expect(app.apicache.getIndex().all.length).to.equal(0)
          })
      })

      it('works when called with no key', function() {
        var app = mockAPI.create('10 seconds')

        expect(app.apicache.getIndex().all.length).to.equal(0)
        expect(app.apicache.clear().all.length).to.equal(0)
        return request(app)
          .get('/api/movies')
          .then(function(res) {
            expect(app.requestsProcessed).to.equal(1)
            expect(app.apicache.getIndex().all.length).to.equal(1)
            expect(app.apicache.clear().all.length).to.equal(0)
          })
      })
    })
  })
})
