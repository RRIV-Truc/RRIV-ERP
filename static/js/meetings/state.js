/* state.js — PhonghopState */
(function () {
  'use strict';

  window.PhonghopState = {
    state: {
      currentUser: null,
      meetings: [],
      rooms: [],
      employees: [],
      orgDirectory: { personnel: [], departments: [], teams: [], positions: [], systemRoles: [] },
      loading: false
    }
  };
})();
