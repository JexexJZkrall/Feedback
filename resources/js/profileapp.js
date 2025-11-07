var app = angular.module("Profile",["ui.bootstrap"]);

app.controller("ProfileController",function($scope, $http, $timeout) {
    var self = $scope;

    self.activeUser = {};
    self.editValues = {newMail: "", newSex: ""};
    self.isEmailValid = true;
    self.editProf = false;
    self.sexOptions = [{label: "Male", value: "M"}, {label: "Female", value: "F"}, {label: "Other", value: "O"}, {label: "I'd rather not say", value:"N"}];

    self.getCurrentUser = function() {
        $http.post("current-user").then(function(response){
            self.activeUser.name = response.data.name;
            self.activeUser.fname = response.data.fname;
            self.activeUser.mail = response.data.mail;
            self.activeUser.sex = self.sexOptions.find(s => s.value == response.data.sex).label;
            self.editValues.newSex = response.data.sex;
            self.editValues.newMail = response.data.mail;
        })
    }

    self.saveData = function() {
        let sexLabel = self.sexOptions.find(sex => sex.value == self.editValues.newSex).label;
        if (self.editValues.newMail == self.activeUser.mail && sexLabel == self.activeUser.sex){
            return;
        }

        let emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(self.editValues.newMail || "")){
            self.isEmailValid = false;
            return;
        }
        self.isEmailValid = true;
        self.editProf = false;
        $http.post("edit-profile",{mail: self.editValues.newMail, sex: self.editValues.newSex})
            .then(() => {
                $timeout(() => {
                    self.getCurrentUser();
                },0)
            });
        
    }

    self.toggleEdit = function() {
        self.editProf = !self.editProf;
    }

    self.getCurrentUser();
});