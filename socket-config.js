const sessions = {};
let feedback;

module.exports.configSocket = function(io){
    feedback = io.of("/Feedback");
    //feedback = io;

    feedback.on("connection", (socket) => {
        socket.on("joinSession", (data) => {
            let uid = data.uid;
            let uname = data.uname;
            let sesid = String(data.sesid);
            if (!uid || !sesid) return;
            
            socket.join(sesid);
            if (!sessions[sesid]) sessions[sesid] = {};
            sessions[sesid][socket.id] = {uid:uid,uname:uname};
            feedback.to(sesid).emit("sessionUsers", Object.values(sessions[sesid]));
        });

        socket.on("disconnecting", () => {
            for (let sesid in sessions){
                if (sessions[sesid][socket.id]){
                    delete sessions[sesid][socket.id];
                    feedback.to(sesid).emit("sessionUsers", Object.values(sessions[sesid]));
                    if (Object.keys(sessions[sesid]).length === 0){
                        delete sessions[sesid];
                    }
                    break;
                }
            }
        });
    });

    module.exports.updMsg = function(sesid){
        feedback.to(String(sesid)).emit("upd",{});
    };
    module.exports.updChat = function(sesid){
        feedback.to(String(sesid)).emit("chat", {});
    };
    module.exports.updAnalysis = function(sesid){
        feedback.to(String(sesid)).emit("info",{});
    }
    module.exports.thinkingBot = function(sesid,isThink){
        feedback.to(String(sesid)).emit("think",{thinking:isThink});
    }
};
