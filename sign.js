var timespan = require('./lib/timespan');
var xtend = require('xtend');
var jws = require('jws');
var includes = require('lodash.includes');
var isArray = require('lodash.isarray');
var isBoolean = require('lodash.isboolean');
var isInteger = require('lodash.isinteger');
var isNumber = require('lodash.isnumber');
var isPlainObject = require('lodash.isplainobject');
var isString = require('lodash.isstring');
var once = require('lodash.once');

var sign_options_schema = {
  expiresIn: function(value) { return isInteger(value) || isString(value); },
  notBefore: function(value) { return isInteger(value) || isString(value); },
  audience: function(value) { return isString(value) || isArray(value); },
  algorithm: includes.bind(null, ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'HS256', 'HS384', 'HS512', 'none']),
  header: isPlainObject,
  encoding: isString,
  issuer: isString,
  subject: isString,
  jwtid: isString,
  noTimestamp: isBoolean,
  keyid: isString
};

var registered_claims_schema = {
  iat: isNumber,
  exp: isNumber,
  nbf: isNumber
};

function validate(schema, unknown, object) {
  if (!isPlainObject(object)) {
    throw new Error('Expected object');
  }
  Object.keys(object)
    .forEach(function(key) {
      if (schema[key] == null) {
        if (!unknown) {
          throw new Error('"' + key + '" is not allowed');
        }
        return;
      }
      if (!schema[key](object[key])) {
        throw new Error('"' + key + '" is not the correct type');
      }
    });
}

var options_to_payload = {
  'audience': 'aud',
  'issuer': 'iss',
  'subject': 'sub',
  'jwtid': 'jti'
};

var options_for_objects = [
  'expiresIn',
  'notBefore',
  'noTimestamp',
  'audience',
  'issuer',
  'subject',
  'jwtid',
];

module.exports = function (payload, secretOrPrivateKey, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  } else {
    options = options || {};
  }

  var isObjectPayload = typeof payload === 'object' &&
                        !Buffer.isBuffer(payload);

  var header = xtend({
    alg: options.algorithm || 'HS256',
    typ: isObjectPayload ? 'JWT' : undefined,
    kid: options.keyid
  }, options.header);

  function failure(err) {
    if (callback) {
      return callback(err);
    }
    throw err;
  }

  if (!secretOrPrivateKey && options.algorithm !== 'none') {
    return failure(new Error('secretOrPrivateKey must have a value'));
  }

  if (typeof payload === 'undefined') {
    return failure(new Error('payload is required'));
  } else if (isObjectPayload) {
    try {
      validate(registered_claims_schema, true, payload);
    }
    catch (error) {
      return failure(error);
    }
    payload = xtend(payload);
  } else {
    var invalid_options = options_for_objects.filter(function (opt) {
      return typeof options[opt] !== 'undefined';
    });

    if (invalid_options.length > 0) {
      return failure(new Error('invalid ' + invalid_options.join(',') + ' option for ' + (typeof payload ) + ' payload'));
    }
  }

  if (typeof payload.exp !== 'undefined' && typeof options.expiresIn !== 'undefined') {
    return failure(new Error('Bad "options.expiresIn" option the payload already has an "exp" property.'));
  }

  if (typeof payload.nbf !== 'undefined' && typeof options.notBefore !== 'undefined') {
    return failure(new Error('Bad "options.notBefore" option the payload already has an "nbf" property.'));
  }

  try {
    validate(sign_options_schema, false, options);
  }
  catch (error) {
    return failure(error);
  }

  var timestamp = payload.iat || Math.floor(Date.now() / 1000);

  if (!options.noTimestamp) {
    payload.iat = timestamp;
  } else {
    delete payload.iat;
  }

  if (typeof options.notBefore !== 'undefined') {
    payload.nbf = timespan(options.notBefore);
    if (typeof payload.nbf === 'undefined') {
      return failure(new Error('"notBefore" should be a number of seconds or string representing a timespan eg: "1d", "20h", 60'));
    }
  }

  if (typeof options.expiresIn !== 'undefined' && typeof payload === 'object') {
    payload.exp = timespan(options.expiresIn, timestamp);
    if (typeof payload.exp === 'undefined') {
      return failure(new Error('"expiresIn" should be a number of seconds or string representing a timespan eg: "1d", "20h", 60'));
    }
  }

  Object.keys(options_to_payload).forEach(function (key) {
    var claim = options_to_payload[key];
    if (typeof options[key] !== 'undefined') {
      if (typeof payload[claim] !== 'undefined') {
        return failure(new Error('Bad "options.' + key + '" option. The payload already has an "' + claim + '" property.'));
      }
      payload[claim] = options[key];
    }
  });

  var encoding = options.encoding || 'utf8';

  if (typeof callback === 'function') {
    callback = callback && once(callback);

    jws.createSign({
      header: header,
      privateKey: secretOrPrivateKey,
      payload: payload,
      encoding: encoding
    }).once('error', callback)
      .once('done', function (signature) {
        callback(null, signature);
      });
  } else {
    return jws.sign({header: header, payload: payload, secret: secretOrPrivateKey, encoding: encoding});
  }
};
