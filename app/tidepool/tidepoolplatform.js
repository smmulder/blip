var dataHelpers = require('./data/datahelpers.js');

module.exports = function(options){
  var _ = window._;
  var superagent = window.superagent;
  var bows = window.bows;
  var Rx = window.Rx;

  var apiHost = options.apiHost;
  var uploadApi = options.uploadApi;

  var api = {
    user: {},
    patient: {},
    patientData: {}
  };

  var log = bows('Tidepool');

  var sessionTokenHeader = 'x-tidepool-session-token';
  var token = null;
  var userid = null;

  var PATIENT_GETALL_NOT_IMPLEMENTED = true;

  function makeUrl(path) {
    return apiHost + path;
  }

  function setupUser(api) {
    api.get = function(cb) {
      if (token == null || userid == null) {
        return cb({ message: 'Not logged in' });
      }

      // First fetch user account data (username)
      var uri = '/auth/user';
      log('GET ' + uri);
      superagent.get(makeUrl(uri))
        .set(sessionTokenHeader, token)
        .end(function(err, res) {
          if (err != null) {
            return cb(err);
          }

          if (res.status !== 200) {
            return cb({status: res.status, response: res.body});
          }

          var user = res.body;
          // Then fetch user profile information (first name, last name, etc.)
          uri = '/metadata/' + userid + '/profile';
          log('GET ' + uri);
          superagent.get(makeUrl(uri))
            .set(sessionTokenHeader, token)
            .end(function(err, res) {
              if (err != null) {
                return cb(err);
              }

              if (res.status !== 200) {
                return cb({status: res.status, response: res.body});
              }

              var data = res.body;
              data.id = userid;
              data.username = user.username;
              // If user profile has patient data, just give the "patient id"
              // (which is the same as the userid for this backend)
              if (data.patient != null) {
                data.patient = {id: userid};
              }
              cb(null, data);
            });
        });
    };

    api.put = function(user, cb) {
      if (token == null || userid == null) {
        return cb({ message: 'Not logged in' });
      }

      // NOTE: Current backend does not yet support changing
      // username or password, only profile info
      var profile = _.omit(user, 'username', 'password');
      var uri = '/metadata/' + userid + '/profile';
      log('POST ' + uri);
      superagent.post(makeUrl(uri))
        .set(sessionTokenHeader, token)
        .send(profile)
        .end(function(err, res) {
          if (err != null) {
            return cb(err);
          }

          if (res.status !== 200) {
            return cb({status: res.status, response: res.body});
          }

          var data = res.body;
          data.id = userid;
          data.username = user.username;
          // If user profile has patient data, just give the "patient id"
          // (which is the same as the userid for this backend)
          if (data.patient != null) {
            data.patient = {id: userid};
          }
          cb(null, data);
        });
    };
  }

  function setupPatient(api) {
    api.get = function(patientId, cb) {
      if (token == null || userid == null) {
        return cb({ message: 'Not logged in' });
      }

      // For this backend, the "patientId" is actually a "userId"
      // And patient data is contained in the `patient` attribute of
      // the user's profile
      var uri = '/metadata/' + patientId + '/profile';
      log('GET ' + uri);
      superagent.get(makeUrl(uri))
        .set(sessionTokenHeader, token)
        .end(function(err, res) {
          if (err != null) {
            return cb(err);
          }

          if (res.status !== 200) {
            return cb({status: res.status, response: res.body});
          }

          var profile = res.body;
          if (profile.patient == null) {
            // No patient profile for this user yet, return "not found"
            return cb({status: 404, response: 'Not found'});
          }
          // Merge user profile attributes with patient
          var patient = profile.patient;
          patient.id = patientId;
          patient.firstName = profile.firstName;
          patient.lastName = profile.lastName;
          cb(null, patient);
        });
    };

    api.post = function(patient, cb) {
      return putPatient(userid, patient, cb);
    };

    api.put = putPatient;

    function putPatient(patientId, patient, cb) {
      if (token == null || userid == null) {
        return cb({ message: 'Not logged in' });
      }

      // For this backend, patient data is contained in the `patient`
      // attribute of the user's profile
      var profileSent = {patient: patient};
      var uri = '/metadata/' + patientId + '/profile';
      log('POST ' + uri);
      superagent.post(makeUrl(uri))
        .set(sessionTokenHeader, token)
        .send(profileSent)
        .end(function(err, res) {
          if (err != null) {
            return cb(err);
          }

          if (res.status !== 200) {
            return cb({status: res.status, response: res.body});
          }

          var profile = res.body;
          // Merge user profile attributes with patient
          var patient = profile.patient;
          patient.id = patientId;
          patient.firstName = profile.firstName;
          patient.lastName = profile.lastName;
          cb(null, patient);
        });
    }
  }

  function setupAuth(api) {
    function saveSession(newUserid, newToken) {
      token = newToken;
      userid = newUserid;
      if (newToken != null) {
        setTimeout(
          function(){
            if (token == null || newUserid !== userid) {
              return;
            }

            var uri = '/auth/login';
            log('GET ' + uri);
            superagent.get(makeUrl(uri))
              .set(sessionTokenHeader, token)
              .end(
              function(err, res){
                if (err) {
                  log(err);
                  return;
                }

                if (res.status === 200) {
                  saveSession(newUserid, res.headers[sessionTokenHeader]);
                } else {
                  log('Unknown response when refreshing token' + res.status);
                }
              });
          },
          10 * 60 * 1000
        );
      }
    }

    api.isAuthenticated = function() {
      return Boolean(token);
    };

    api.login = function(user, cb) {
      if (user.username == null) {
        return cb({ message: 'Must specify an username' });
      }
      if (user.password == null) {
        return cb({ message: 'Must specify a password' });
      }

      var uri = '/auth/login';
      log('POST ' + uri);
      superagent.post(makeUrl(uri))
        .auth(user.username, user.password)
        .end(
        function(err, res) {
          if (err != null) {
            return cb(err);
          }

          if (res.status !== 200) {
            return cb({status: res.status, response: res.body});
          }

          saveSession(res.body.userid, res.headers[sessionTokenHeader]);
          cb();
        });
    };

    api.logout = function(cb) {
      if (token == null) {
        return cb(null);
      }

      var oldToken = token;
      saveSession(null, null);
      var uri = '/auth/logout';
      log('POST ' + uri);
      superagent.post(makeUrl(uri))
        .set(sessionTokenHeader, oldToken)
        .end(function(err, res){ cb(err); });
    };

    api.signup = function(user, cb) {
      if (user.username == null) {
        return cb({ message: 'Must specify a username' });
      }
      if (user.password == null) {
        return cb({ message: 'Must specify a password' });
      }

      // First, create user account
      var userApiUser = _.assign(
        {},
        _.pick(user, 'username', 'password'),
        {emails: [user.username]}
      );
      var uri = '/auth/user';
      log('POST ' + uri);
      superagent.post(makeUrl(uri))
        .send(userApiUser)
        .end(function(err, res) {
          if (err != null) {
            return cb(err);
          }

          if (res.status !== 201) {
            return cb({status: res.status, response: res.body});
          }

          var userApiBody = res.body;
          saveSession(userApiBody.userid, res.headers[sessionTokenHeader]);

          // Then, add additional user info (first name, etc.) to profile
          var profile = _.omit(user, 'username', 'password');
          uri = '/metadata/' + userid + '/profile';
          log('POST ' + uri);
          superagent.post(makeUrl(uri))
            .set(sessionTokenHeader, token)
            .send(profile)
            .end(function(err, res) {
              if (err != null) {
                return cb(err);
              }

              if (res.status !== 200) {
                return cb({status: res.status, response: res.body});
              }

              // Add back some account info to profile for response
              var data = res.body;
              data.id = userid;
              data.username = user.username;
              cb(null, data);
            });
        });
    };
  }

  function setupPatientData(api) {
    api.get = function(patientId, options, cb) {
      if (token == null || userid == null) {
        return cb({ message: 'Not logged in' });
      }

      if (typeof options === 'function') {
        cb = options;
      }

      var uri = '/data/' + patientId;
      log('GET ' + uri);
      superagent.get(makeUrl(uri))
        .set(sessionTokenHeader, token)
        .end(
        function(err, res){
          if (err != null) {
            return cb(err);
          }

          if (res.status === 200) {
            Rx.Observable.fromArray(res.body)
              .tidepoolConvertBasal()
              .tidepoolConvertBolus()
              .map(function(e){
                e.value = Number(e.value);
                return e;
              })
              .flatMap(function(datum) {
                if (datum.type === 'wizard') {
                  return Rx.Observable.fromArray(
                    [ datum,
                      { _id: datum._id + 'carbs',
                        type: 'carbs',
                        deviceTime: datum.deviceTime,
                        value: datum.payload.carbInput,
                        units: datum.payload.carbUnits
                      }
                    ]
                  );
                } else {
                  return Rx.Observable.return(datum);
                }
              })
              .toArray()
              .subscribe(
              function(data) {
                cb(null, data);
              },
              cb
            );
          } else {
            cb(null, null);
          }
        });
    };
  }

  function setupUpload(api) {
    api.getUploadUrl = function() {
      if (token == null) {
        return null;
      }
      return uploadApi + '?token=' + token;
    };
  }

  setupAuth(api.user);
  setupUser(api.user);
  setupPatient(api.patient);
  setupPatientData(api.patientData);
  setupUpload(api);

  api.getToken = function() {
    return token;
  };

  api.getUserId = function() {
    return userid;
  };

  return api;
};
