var TwitterV2 = require("twitter-api-v2");
var pg = require('pg');
var twConfig = require("./passwords.js")("twConfig");
var twSecret = require("./passwords.js")("twSecret");
var conString = require("./passwords.js")("conString");
var twCount = require("./passwords")("twCount");

var twSocket = new TwitterV2(twConfig["bearer_token"]);
var id_tb = 3;

/**
 * Middleware function to retrieve tweets from streaming api and return as feeds
 * @param req Request object from middleware
 * @param res Response object from middleware
 */
module.exports.tweetsAsFeeds = function(socket){
    return function(req, res){
        var data = req.body;
        if(req.session.uid==null || data["text"]==null || data["text"]=="" || data["geo"]==null || data["geo"]=="" || data["secret"]!=twSecret){
            res.end("[]");
            return;
        }
        var twOptions = {
            q: data["text"],
            count: twCount,
            geocode: data["geo"]
        };
        var inow = ""+(+Date.now());
        let fullQuery = data["text"]+" point_radius:["+data["geo"]+"]";
        twSocket.v2.search(fullQuery,{max_results: twOptions.count,'tweet.fields': ['created_at','geo','author_id'], 'place.fields':['full_name', 'country', 'geo']})
            .then(response => {
                console.log(response);
                if (response.data == null){
                    console.error("NO DATA ATTRIBUTE FOUND!");
                    res.end("[]");
                    return;
                }
                let arr = response.data.map(adapterTweetToFeed(twOptions.geocode,inow));
                for(var i=0; i<arr.length; i++){
                    addDBTweet(arr[i], req.session.ses);
                }
                res.end(JSON.stringify(arr));
                socket.updMsg();
            })
            .catch(err => {
                res.end("[]");
                return;
            });
        var searchContent = {type: "t", time: inow, options: twOptions};
        storeDBSearch(req.session.uid,req.session.ses,JSON.stringify(searchContent));
    }
};


module.exports.trendings = function(req, res){
    if(req.session.uid==null){
        res.end("[]");
        return;
    }
    var twOptions = {
        id: 1
    };
    twSocket.get("trends/place", twOptions, function(err, data, response){
        console.log(data);
        var arr = data[0].trends.map(function(e){
            return {"topic": e.name, "popular": e["tweet_volume"]};
        });
        res.end(JSON.stringify(arr));
    });
};

module.exports.userTweets = function(req, res){
    var data = req.body;
    if(req.session.uid==null || data["user"]==null || data["user"]=="" || data["secret"]!=twSecret){
        res.end("[]");
        return;
    }
    var twOptions = {
        "screen_name": data["user"],
        count: twCount,
        "include_rts": false
    };
    var inow = ""+(+Date.now());
    twSocket.v2.userByUsername(data["user"])
        .then(userResponse => {
            let userId = userResponse.data.id;
            return twSocket.v2.userTimeline(userId,{exclude: 'retweets'});
        })
        .then(response => {
            console.log(response);
            let arr = data.map(adapterTweetToFeed(null,inow));
            for(let i=0;i<arr.length;i++){
                addDBTweet(arr[i], req.session.ses);
            }
            res.end(JSON.stringify(arr));
        })
        .catch(err => {
            res.end("[]");
            return;
        });
    var searchContent = {type: "u", time: inow, options: twOptions};
    storeDBSearch(req.session.uid,req.session.ses,JSON.stringify(searchContent));
};

/**
 * Converts a tweet object to a feed object
 * @param gc geocode to be used as extra
 * @return Function - The function to wrap the feed object that represent the tweet
 */
var adapterTweetToFeed = function(gc,inow,response){
    var ss = "";
    if(gc!=null)
        ss = wktFromCoords(gc.split(",")[1],gc.split(",")[0]);
    return function(tweet,i){
        var geoloc = null;
        if(tweet.geo){
            if(tweet.geo.coordinates){
                geoloc = twCoordToWkt(tweet.geo.coordinates);
            } else if (tweet.geo.place_id){
                let place = response.includes.places.find(p => p.id === tweet.geo.place_id);
                geoloc = twPlaceCoordToWkt(place.geo.bbox);
            };
        }
        var username = null;
        if(tweet.author_id){
            username = response.includes.users.find(user => user.id === tweet.author_id).username;
        }
        return {
            id: +(tweet.id),
            descr: tweet.text.replace("\n", ""),
            author: id_tb,
            time: +(new Date(tweet.created_at)),
            geom: geoloc,
            parentfeed: -1,
            extra: tweet.id + "|@" + username + ((ss!="")?"|":"") + ss + "|" + inow
        };
    };
};

/**
 * Convert a coordinate tweet object to wkt text
 * @param coords coordinate tweet object to be converted
 * @return string in wkt format or null if not a point.
 */
var twCoordToWkt = function(coords){
    if(coords.type=="Point"){
        return "POINT("+coords.coordinates[0]+" "+coords.coordinates[1]+")";
    }
    return null;
};

/**
 * Convert an array coordinate tweet object to wkt text
 * @param crds coordinate tweet object to be converted
 * @return string in wkt format or null if not a point.
 */
var twPlaceCoordToWkt = function(crds){
    var coords = crds[0];
    var slng = 0;
    var slat = 0;
    for(var i=0; i<coords.length; i++){
        slng += coords[i][0];
        slat += coords[i][1];
    }
    return "POINT("+(slng/coords.length)+" "+(slat/coords.length)+")";
};

var wktFromCoords = function(lng,lat){
    return "POINT("+lng+" "+lat+")";
};

/**
 * Adds a tweet feed to the database
 * @param tw The tweet feed object to be added
 * @param ses The session where the feed belongs to
 */
function addDBTweet(tw,ses){
    var sql = "insert into feeds(descr,time,author,sesid,geom,extra) values($1,$2,$3,$4,$5,$6);";
    var db = new pg.Client(conString);
    db.connect();
    var qry = db.query(sql,[tw.descr,new Date(tw.time),tw.author,ses,tw.geom,tw.extra]);
    qry.then(function(response){
        db.end();
    });
    /*
    qry.on("end",function(){
        db.end();
    });
    */
}

/**
 * Stores a search done to twitter api
 * @param uid the id of the user
 * @param ses the id of the current session
 * @param text the json stringfied text of the search
 */
var storeDBSearch = function(uid,ses,text){
    var sql = "insert into history(uid,sesid,query) values($1,$2,$3)";
    var db = new pg.Client(conString);
    db.connect();
    var qry = db.query(sql,[uid,ses,text]);
    qry.then(function(response){
        db.end();
    });
    /*
    qry.on("end",function(){
        db.end();
    });
    */
};