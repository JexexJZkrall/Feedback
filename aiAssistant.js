let pg = require('pg');
let conString = require("./passwords.js")("conString");

var api_key = require("./passwords.js")("openai_key");

module.exports.askAssistant = function(socket) {
    return async function(req,res){
        const { default: OpenAI } = await import("openai");
        const openai = new OpenAI({apiKey: api_key});
        let usrMsg = req.body["msg"];
        console.log(usrMsg);
        let ses = req.session.ses;
        //let feed = getFeed(ses);
        let sql = "select f.descr from feeds as f where f.sesid= $1";
        let db = new pg.Client(conString);
        db.connect();
        let qry = await db.query(sql,[ses]);
        db.end();
        let arr = [...qry.rows];
        let response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a helpful assistant. You are reffered to as @bot. You help users extract information from twitter posts"},
                { role: "system", content: `Use the following tweets list to answer the user questions. Tweets: ${arr.map(item => JSON.stringify(item)).join(", ")}`},
                {
                    role: "user",
                    content: usrMsg,
                },
            ],
        });
        saveBotMsg(response.choices[0].message.content,ses);
        socket.updChat();
        res.end();
    }
};

var saveBotMsg = function(msg,session){
    let sql = "insert into chat(content,sesid,uid,ctime) values ($1,$2,58,now())"
    let db = new pg.Client(conString);
    db.connect();
    let qry = db.query(sql,[msg,session]);
    qry.then(function(response){
        db.end();
    });
};