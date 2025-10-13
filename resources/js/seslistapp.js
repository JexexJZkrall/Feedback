var app = angular.module("SesList",["ui.bootstrap","ui.multiselect"]);

app.controller("SesListController",function($scope, $http, $uibModal){

    var self = $scope;

    self.newsesopen = false;
    self.sessions = [];
    self.newses = {name: "", descr: ""};
    self.activeUser = "";

    self.toggleOpen = function(){
        self.newsesopen = !self.newsesopen;
    };

    self.updateList = function() {
        $http({url: "seslist", method: "post"}).then(function (response) {
            self.sessions = response.data.reverse();
        });
    };

    self.addNewSession = function(){
        if(self.newses.name!="" && self.newses.descr!=""){
            $http({url: "newses", method: "post", data:self.newses}).then(function(response){
                if(response.data.status == "ok"){
                    self.updateList();
                }
            });
            self.newses = {name: "", descr: ""};
            self.newsesopen = false;
        }
    };

    self.confirmDeleteSession = function(ses, event){
        event.stopPropagation();
        event.preventDefault();
        if (confirm("¿Seguro que quieres eliminar la sesión "+ ses.name+"?")){
            self.deleteSession(ses.id);
        }
    }

    self.deleteSession = function(sesid){
        $http.post("delete-session",{ses: sesid}).then(function(response){
            if(response.data.status == "ok"){
                self.updateList();
            }
        })
    }

    self.getId = function() {
         $http.get("current-user").then(function(response){
            self.activeUser = response.data;
         })
    }

    self.openUsers = function(idx,event){
        event.stopPropagation();
        event.preventDefault();
        $uibModal.open({
            templateUrl: "templ/modal_sesusers.html",
            controller: "SesUsersController",
            resolve: {
                params: function(){
                    return {
                        ses: idx,
                        sesname: self.sessions.filter(function(e){return e.id == idx})[0].name,
                        sescreator: self.sessions.filter(function(e){return e.id == idx})[0].creator,
                        activeUser: self.activeUser
                    }
                }
            }
        });
    };

    self.updateList();
    self.getId();
});

app.controller("SesUsersController",function($scope,$http,$timeout,params){
    var self = $scope;
    self.users = [];
    self.sesname = params.sesname;
    self.sesid = params.ses;
    self.sescreator = params.sescreator;
    self.newMembs = [];
    self.results = [];
    self.searchBar = "";
    self.activeUser = params.activeUser;

    let searchTimeout;

    self.updateUsers = function() {
        $http({url: "user-list-ses", method: "post", data: {ses: params.ses}}).then(function (response) {
            self.users = response.data.filter(u => ! (u.id == 3 | u.id == 58));
        });
    };

    self.selectNotMembers = function(){
        return self.users.filter(function(e){return !e.member});
    };

    self.selectMembers = function(){
        return self.users.filter(function(e){return e.member});
    };

    self.addToSession = function(){
        if(self.newMembs.length==0) return;
        var postdata = {
            users: self.newMembs.map(function(e){return e.id;}),
            sesid: self.sesid
        };
        $http({url: "add-ses-users", method: "post", data:postdata}).then(function (response){
            if(response.data.status=="ok") {
                self.newMembs = [];
                self.updateUsers();
            }
        });
    };

    self.searchUsers = function(){
        if (searchTimeout) $timeout.cancel(searchTimeout);
        searchTimeout = $timeout(function(){
            if(self.searchBar.length < 3){
                self.results = [];
                return;
            }
            $http.post("user-list-search",{ses: self.sesid, name:self.searchBar})
                .then(function(response){
                    self.results = response.data.filter(u => !self.users.some(user => user.id == u.id))
                                                .filter(u => !self.newMembs.some(user => user.id == u.id));
                });
        }, 300);
    }

    self.addUser = function(user){
        if (!self.newMembs.find(u => u.id === user.id) && !self.users.find(u => u.id === user.id)){
            self.newMembs.push(user);
        }
        self.results = [];
        self.searchBar = "";
    }

    self.removeFromSession = function(user) {
        $http.post("remove-user-ses", {user: user.id, sesid: self.sesid})
        self.users = self.users.filter(u => u.id != user.id);
    }

    self.removeSelection = function(user) {
        self.newMembs = self.newMembs.filter(u => u.id != user.id);
    }

    self.updateUsers();

});