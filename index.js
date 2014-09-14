'use strict';

var EventEmitter = require('events').EventEmitter,
    CircuitBreaker = require('circuit-breaker-js');


/**
 * Create a circuit breaker for a service.
 *
 * @param  {String} service Name of the service being protected by the circuit breaker.
 * @param  {String} name    Name of the circuit breaker.
 * @param  {Object} options CircuitBreaker options
 * @return {Object} Object with `wrap`.
 *
 * @event run         Emitted before calling the worker.
 * @event success     Emitted after successfull work.
 * @event failure     Emitted after failed work.
 * @event rejected    Emitted when work is rejected because the breaker is open.
 * @event stateChange Emitted when breaker state changes between open and closed.
 * @event open        Emitted when breaker state changes from closed to open.
 * @event closed      Emitted when breaker state changes from open to closed.
 */
exports.create = function(service, name, options) {
  var emitter = new EventEmitter(),
      breaker,
      lastStateChange;

  function getState() {
    switch (breaker._state) {
      case CircuitBreaker.OPEN:
        return 'open';
      case CircuitBreaker.HALF_OPEN:
        return 'halfOpen';
      case CircuitBreaker.CLOSED:
        return 'closed';
    }
  }

  function emitStateChange(metrics) {
    var state = getState(),
        now = Date.now(),
        duration = lastStateChange ? (now - lastStateChange) / 1000 : null;

    lastStateChange = now;

    ['stateChange', state].forEach(function(event) {
      emitter.emit(event, {
        service: service,
        name: name,
        state: state,
        duration: duration,
        time: new Date(now),
        totalCount: metrics.totalCount,
        errorCount: metrics.errorCount,
        errorPercentage: metrics.errorPercentage
      });
    });
  }

  options = options || {};
  breaker = new CircuitBreaker({
    windowDuration: options.windowDuration,
    numBuckets: options.numBuckets,
    timeoutDuration: options.timeoutDuration,
    errorThreshold: options.errorThreshold,
    volumeThreshold: options.volumeThreshold,
    onCircuitOpen: emitStateChange,
    onCircuitClose: emitStateChange
  });

  function emitWithArgs(event, args) {
    emitter.emit(event, {
      service: service,
      name: name,
      state: getState(),
      args: args
    });
  }

  function run(worker, args, callback) {
    breaker.run(function(success, failure) {
      emitWithArgs('run', args);
      worker.apply(null, args.concat([function() {
        if (callback.apply(this, arguments)) {
          success();
          emitWithArgs('success', args);
        }
        else {
          failure();
          emitWithArgs('failure', args);
        }
      }]));
    }, function() {
      emitWithArgs('rejected', args);
      callback(new Error('Service Unavailable: ' + service + ' (' + name + ')'));
    });
  }

  /**
   * Run a function with provided arguments and invoke the callback.
   * @param  {Function} worker   A function with work to do.
   * @param  {...*}     args     Arguments passed to the worker.
   * @param  {Function} callback Called when work is done or rejected. Unlike a normal callback this
   *                             function should return true or false depending on whether the work
   *                             was a success.
   */
  emitter.run = function(worker) {
    var args = Array.prototype.slice.call(arguments, 1),
        callback = args.pop();
    run(worker, args, callback);
  };

  /**
   * @param  {Function} worker   A function with work to do.
   * @param  {...*}     args     Arguments passed to the worker. Not including callback.
   * @return {Object} An object with `args` and `run` where `args` is and array of any arguments
   *                  passed after the worker and `run` is a function that takes a callback and
   *                  runs the worker with the circuit breaker.
   */
  emitter.wrap = function(worker) {
    var args = Array.prototype.slice.call(arguments, 1);
    return {
      args: args,
      run: function(callback) {
        run(worker, args, callback);
      }
    };
  };

  return emitter;
};
