// CollabHeatMap Server 
var express = require('express');
var session = require('express-session');
var pg = require('pg');
var crypto = require('crypto');
var rpg = require("./rest-pg.js");
var bb = require('express-busboy');
var twAdpt = require("./xAdapter.js");
var socket = require("./socket-config.js");
let mailer = require("nodemailer");
var aiAdpt = require("./aiAssistant.js");

var app = module.exports = express();
var conString = require("./passwords.js")("conString");

var port = 8502;

app.use(express.static(__dirname+'/resources'));
bb.extend(app,{upload: true});
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(session({secret: 'ssshhh', saveUninitialized: false, resave: false}));


let mailserv = mailer.createTransport({
    sendmail: true,
    newline: 'unix'
});

app.get("/",function(req,res){
    if(req.session.uid){
        if(req.session.ses)
            res.render("index",{ses: req.session.ses});
        else
            res.redirect("seslist");
    }
    else{
        res.redirect("login");
    }
});

app.get("/seslist",function(req,res){
    if(req.session.uid)
        res.render("seslist");
    else
        res.redirect(".");
});

app.get("/login",function(req,res){
     res.render("login", {rc: req.query.rc});
});

app.get("/logout",function(req,res){
    req.session.uid = null;
    req.session.ses = null;
    res.redirect(".");
});

app.get("/register",function(req,res){
    res.render("register");
});

app.get("/forgot-pass", function(req,res){
    res.render("forgot-pass");
});

app.post("/login", async function(req,res){
    var sql = "select id as login from users where (username = $1 and pass = $2) or (mail = $3 and pass=$4)";
    var db = new pg.Client(conString);
    try {	
        await db.connect();
    } catch (err) {
	    console.log(err);
    }
    var passenc = crypto.createHash('md5').update(req.body.pass).digest('hex');
    let id = -1;
    try {
    	var qry = await db.query(sql,[req.body.user,passenc,req.body.user,passenc]);
        id = qry.rows[0].login;    
    } catch (err) {
	    console.log(err);
    }
    if (id != -1) {
	    req.session.uid = id;
	    res.redirect(".");
    } else {
	    res.redirect("login?rc=2");
    }
    //qry.on("row",function(row){
	//console.log(row.login);    
        //id = row.login;
    //});
    //qry.on("end",function(){
        //if(id!=-1) {
            //req.session.uid = id;
            //res.redirect(".");
        //}
        //else{
            //res.redirect("login?rc=2");
        //}
    //});
});

app.post("/register", rpg.execSQL({
    dbcon: conString,
    sql: "insert into users(username,pass,fullname,mail,sex) values ($1,$2,$3,$4,$5)",
    postReqData: ["name","user","pass","mail","sex"],
    onStart: function(ses,data,calc){
	try {
        if(data.pass.length<5) return "select $1, $2, $3 from users";
        calc.passcr = crypto.createHash('md5').update(data.pass).digest('hex');
        calc.fullname = (data.name+" "+data.lastname);
	} catch (error) {
		console.error("error at register:",error);
	}
    },
    sqlParams: [rpg.sqlParam("post","user"),rpg.sqlParam("calc","passcr"),rpg.sqlParam("calc","fullname"),
        rpg.sqlParam("post","mail"),rpg.sqlParam("post","sex")],
    onEnd: function(req,res,error){
	if (error) {
		console.error("error at register:",error);
	}
        res.redirect("login?rc=1");
    }
}));

app.post("/resetpassword", rpg.execSQL({
    dbcon: conString,
    sql: "insert into pass_reset(mail, token, ctime) values ($1,$2,now())",
    postReqData: ["mail"],
    onStart: (ses, data, calc) => {
        let n = ~~(Math.random()*32768);
        calc.token = "" + n + crypto.createHash('md5').update(data.user).digest('hex');
        let mailopts = {
            from: "noreply@saduewa.dcc.uchile.cl",
            to: data.user,
            subject: "Feedback Password Reset",
            text: "You can reset your password by clicking the link below \n " +
                "https://saduewa.dcc.uchile.cl:8888/feedback/new-pass/" + calc.token + "\n\nFeedback."
        };
        mailserv.sendMail(mailopts, function(err,info){
            if(!err){
                console.log("Mail sent");
            }
        });
    },
    sqlParams: [rpg.sqlParam("post", "user"), rpg.sqlParam("calc", "token")],
    onEnd: (req, res) => {
        res.redirect("login?rc=3");
    }
}));

app.get("/new-pass/:token", (req, res) => {
    res.render("newpass", {token: req.params.token});
});

app.post("/newpassword", rpg.execSQL({
    dbcon: conString,
    sql: "update users as u set pass = $1 from pass_reset as r where r.token = $2 and r.mail = u.mail",
    postReqData: ["token", "pass"],
    onStart: (ses, data, calc) => {
        if (data.pass.length < 5) return "select 1";
        calc.passcr = crypto.createHash('md5').update(data.pass).digest('hex');
    },
    sqlParams: [rpg.sqlParam("calc", "passcr"), rpg.sqlParam("post", "token")],
    onEnd: (req, res) => {
        res.redirect("login?rc=4");
    }
}));

app.get("/set-session",function(req,res){
    if(req.session.uid!=null && req.query.ses!=null) {
        req.session.ses = req.query.ses;
    }
    res.redirect(".");
});

app.post("/seslist", rpg.multiSQL({
    dbcon: conString,
    sql: "select s.id, s.name, s.descr from sessions as s inner join sesusers as su on s.id=su.sesid where su.uid = $1",
    sesReqData: ["uid"],
    sqlParams: [rpg.sqlParam("ses","uid")]
}));

app.post("/newses", rpg.singleSQL({
    dbcon: conString,
    sql: "insert into sessions(name,descr,time,creator) values ($1,$2,now(),$3) returning id",
    sesReqData: ["uid"],
    postReqData: ["name","descr"],
    sqlParams: [rpg.sqlParam("post","name"),rpg.sqlParam("post","descr"),rpg.sqlParam("ses","uid")],
    onEnd: function(req,res,result){
        var uid = req.session.uid;
        addSesUser(uid,result.id);
        res.send('{"status":"ok"}');
    }
}));

app.post("/member-list", rpg.multiSQL({
    dbcon: conString,
    sql: "select u.id, u.username, u.fullname from users as u inner join (select * from sesusers where sesid=$1) as su on su.uid = u.id",
    sesReqData: ["uid","ses"],
    sqlParams: [rpg.sqlParam("ses","ses")]
}));

app.post("/user-list-ses", rpg.multiSQL({
    dbcon: conString,
    sql: "select u.id, u.username, u.fullname, (su.sesid is not null) as member from users as u left outer join (select * from sesusers where sesid=$1) as su on su.uid = u.id",
    sesReqData: ["uid"],
    postReqData: ["ses"],
    sqlParams: [rpg.sqlParam("post","ses")]
}));

app.post("/feed-list", rpg.multiSQL({
    dbcon: conString,
    sql: "select distinct on (descr) id, author, descr, time, st_astext(geom) as geom, parentfeed, extra from feeds where sesid=$1 order by descr, time desc",
    sesReqData: ["uid","ses"],
    sqlParams: [rpg.sqlParam("ses","ses")]
}));

app.post("/new-feed", rpg.execSQL({
    dbcon: conString,
    sql: "insert into feeds(author,descr,time,geom,sesid,parentfeed) values ($1,$2,now(),st_geomfromtext($3,4326),$4,$5)",
    sesReqData: ["uid","ses"],
    postReqData: ["com"],
    sqlParams: [rpg.sqlParam("ses","uid"),rpg.sqlParam("post","com"),rpg.sqlParam("post","geom"),
        rpg.sqlParam("ses","ses"),rpg.sqlParam("post","parent")],
    onEnd: function(req,res){
        socket.updMsg();
        res.send('{"status":"ok"}');
    }
}));

app.post("/add-ses-users", function(req,res){
    if(req.session.uid==null){
        res.end("");
        return;
    }
    var users = req.body.users;
    var sesid = req.body.sesid;
    for(var i=0; i<users.length; i++){
        addSesUser(users[i],sesid);
    }
    res.end('{"status":"ok"}');
});

app.post("/history-list", rpg.multiSQL({
    dbcon: conString,
    sql: "select id, query from history where sesid = $1",
    sesReqData: ["ses"],
    sqlParams: [rpg.sqlParam("ses","ses")]
}));

app.post("/twitter-feeds", twAdpt.tweetsAsFeeds(socket));
app.post("/twitter-trends", twAdpt.trendings);
app.post("/twitter-user", twAdpt.userTweets);

app.post("/get-ses-info", rpg.singleSQL({
    dbcon: conString,
    sql: "select id, name, descr from sessions where id = $1",
    sesReqData: ["ses"],
    sqlParams: [rpg.sqlParam("ses","ses")]
}));

app.post("/get-chat", rpg.multiSQL({
    dbcon: conString,
    sql: "select c.id, c.content, c.ctime, u.fullname as author from chat as c, users as u where c.uid = u.id and c.sesid = $1 order by c.ctime",
    sesReqData: ["ses"],
    sqlParams: [rpg.sqlParam("ses","ses")]
}));

app.post("/send-chat-msg", rpg.execSQL({
    dbcon: conString,
    sql: "insert into chat(content,sesid,uid,ctime) values ($1,$2,$3,now())",
    sesReqData: ["ses", "uid"],
    postReqData: ["msg"],
    sqlParams: [rpg.sqlParam("post", "msg"), rpg.sqlParam("ses","ses"), rpg.sqlParam("ses","uid")],
    onEnd: function(req,res){
        socket.updChat();
        res.send('{"status":"ok"}');
    }
}));

app.post("/ask-assistant", aiAdpt.askAssistant(socket));

function addSesUser(uid,ses){
    var sql = "insert into sesusers(sesid,uid) values ($1,$2)";
    var db = new pg.Client(conString);
    db.connect();
    var qry = db.query(sql,[ses,uid]);
    qry.then(function(response){
        db.end();
    });
}

if(!module.parent){
    var http = require('http').createServer(app);
    var io = require("socket.io")(http);
    http.listen(port,function(){
        console.log("Listening at port "+port+"\n Ctrl + C to shut down");
    });
    socket.configSocket(io);
}

