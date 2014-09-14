'use strict';

var chai = require('chai'),
    sinon = require('sinon'),
    should = chai.should(),
    cbw = require('..'),
    service = 'Mock Service',
    cb_name = 'test-to-mock-service',
    breaker;

chai.use(require('sinon-chai'));

describe('circuit-breaker-wrapper', function() {

  afterEach(function() {
    breaker = null;
  });

  describe('run', function() {

    beforeEach(function() {
      breaker = cbw.create(service, cb_name);
    });

    it('should run the worker through the circuit breaker with success', function() {
      var fn_1_called_sync = false,
          fn_2_called_sync = false,
          emitSpy = sinon.spy(breaker, 'emit');

      breaker.run(function(arg, callback) {
        fn_1_called_sync = true;
        arg.should.eql(1);
        callback();
      }, 1, function() {
        fn_2_called_sync = true;
        return true;
      });

      emitSpy.should.have.callCount(2);
      emitSpy.should.have.been.calledWith('run');
      emitSpy.should.have.been.calledWith('success');

      // Ensure that booth functions exec sync
      fn_1_called_sync.should.be.true;
      fn_2_called_sync.should.be.true;
    });

    it('should run the worker through the circuit breaker with failure', function() {
      var fn_1_called_sync = false,
          fn_2_called_sync = false,
          emitSpy = sinon.spy(breaker, 'emit');

      breaker.run(function(arg, callback) {
        fn_1_called_sync = true;
        arg.should.eql(1);
        callback();
      }, 1, function() {
        fn_2_called_sync = true;
        return false;
      });

      emitSpy.should.have.callCount(2);
      emitSpy.should.have.been.calledWith('run');
      emitSpy.should.have.been.calledWith('failure');

      // Ensure that booth functions exec sync
      fn_1_called_sync.should.be.true;
      fn_2_called_sync.should.be.true;
    });

  });

  describe('wrap', function() {

    beforeEach(function() {
      breaker = cbw.create(service, cb_name);
    });

    it('should wrap a worker function and return an object with a run method', function() {
      var fn_1_called_sync = false,
          fn_2_called_sync = false,
          emitSpy = sinon.spy(breaker, 'emit'),
          wrapped;

      wrapped = breaker.wrap(function(a, b, c, callback) {
        fn_1_called_sync = true;
        [a, b, c].should.eql([1, 2, 3]);
        callback();
      }, 1, 2, 3);

      wrapped.should.have.keys('args', 'run');
      wrapped.args.should.eql([1, 2, 3]);
      wrapped.run.should.be.a.Function;

      wrapped.run(function(err) {
        should.not.exist(err);
        fn_2_called_sync = true;
        return true;
      });

      emitSpy.should.have.callCount(2);
      emitSpy.should.have.been.calledWith('run');
      emitSpy.should.have.been.calledWith('success');

      // Ensure that booth functions exec sync
      fn_1_called_sync.should.be.true;
      fn_2_called_sync.should.be.true;
    });

  });

  describe('Open circuit breaker', function() {

    beforeEach(function() {
      breaker = cbw.create(service, cb_name);
    });

    it('should change to open if worker fails repeatedly', function(done) {
      var emitSpy = sinon.spy(breaker, 'emit');

      function fn() {
        breaker.run(function(callback) {
          callback();
        }, function(err) {
          var message = 'Service Unavailable: ' + service + ' (' + cb_name + ')';
          if (err) {
            err.should.have.property('message', message);
            emitSpy.should.have.been.calledWith('rejected');
            emitSpy.should.have.been.calledWith('stateChange');
            emitSpy.should.have.been.calledWith('open');
            emitSpy.should.not.have.been.calledWith('closed');
            done();
          }
          else {
            // Circuit breaker is not open yet. Try again.
            setImmediate(fn);
          }
          return false;
        });
      }

      // Start
      fn();
    });

  });

  describe('Close circuit breaker', function() {

    // Recovering to a closed state will take a bit more than the window size (10 seconds).
    this.slow(100);

    beforeEach(function(done) {
      breaker = cbw.create(service, cb_name, {
        windowDuration: 10,
        numBuckets: 10,
        errorThreshold: 50,
        volumeThreshold: 1
      });

      function fn() {
        breaker.run(function(callback) {
          callback();
        }, function(err) {
          if (err) {
            done();
          }
          else {
            // Circuit breaker is not open yet. Try again.
            setImmediate(fn);
          }
          return false;
        });
      }

      fn();
    });

    it('should change back to closed after succeeding repeatedly', function(done) {
      var emitSpy = sinon.spy(breaker, 'emit'),
          consecutiveSuccesses = 0,
          wait_before_retry = 10;

      function fn() {
        breaker.run(function(callback) {
          callback();
        }, function(err) {
          if (err) {
            // Circuit breaker is not closed yet. Try again.
            consecutiveSuccesses = 0;
            setTimeout(fn, wait_before_retry);
          }
          else {
            consecutiveSuccesses++;
            if (consecutiveSuccesses < 3) {
              // Keep at it. Get past the half-open state.
              setTimeout(fn, wait_before_retry);
            }
            else {
              // That should do it...
              emitSpy.should.have.been.calledWith('rejected');
              emitSpy.should.have.been.calledWith('stateChange');
              emitSpy.should.have.been.calledWith('closed');
              emitSpy.should.not.have.been.calledWith('open');
              done();
            }
          }
          return true;
        });
      }

      // Start
      fn();
    });

  });

});
