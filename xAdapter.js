const { TwitterApi } = require("twitter-api-v2");
var pg = require('pg');
var twConfig = require("./passwords.js")("twConfig");
var twSecret = require("./passwords.js")("twSecret");
var conString = require("./passwords.js")("conString");
var twCount = require("./passwords")("twCount");
var pLimit = require('p-limit');

const apiKey = require("./passwords.js")("twApiIoKey"); 
const endpointTweets = "https://api.twitterapi.io/twitter/tweet/advanced_search";
const endpointTrends = "https://api.twitterapi.io/twitter/trends";
const fs = require("fs");

const client = new TwitterApi(twConfig["bearer_token"]);
const rClient = client.readOnly;
var id_tb = 3;

/**
 * Middleware function to retrieve tweets from streaming api and return as feeds
 * @param req Request object from middleware
 * @param res Response object from middleware
 */
module.exports.tweetsAsFeeds = function(socket){
    return async function(req, res){
        var data = req.body;
        if(req.session.uid==null || data["text"]==null || data["text"]=="" || data["geo"]==null || data["geo"]==""){
            res.end("[]");
            return;
        }
        var twOptions = {
            q: data["text"],
            count: twCount,
            geocode: data["geo"],
            qType: data["qType"]
        };
        var inow = ""+(+Date.now());
        let ses = req.session.ses;

        let sql = "select pg_try_advisory_lock($1,hashtext('assistant'));"
        let usql = "select pg_advisory_unlock($1,hashtext('assistant'));"
        let db = new pg.Client(conString);
        db.connect();
        let {rows} = await db.query(sql, [ses]);
        if (!rows[0].pg_try_advisory_lock){
            db.end();
            return res.status(409).end();
        }
        try {
            fetchTweets(twOptions["q"], twOptions["geocode"], twOptions["qType"])
                .then(async function(tweets){
                    const adapter = adapterTweetToFeed(twOptions.geocode,inow);
                    
                    let limit = pLimit(5);
                    let feeds = await Promise.all(
                        tweets.map((tweet,i) =>
                            limit(() => adapter(tweet,i))
                        )
                    );
                    //let feeds = await Promise.all(tweets.map((tweet,i) => adapter(tweet,i)))
                    for (let feed of feeds){
                        await addDBTweet(db,feed,req.session.ses);
                    }
                    let searchContent = {type: "t", time: inow, options: twOptions};
                    await storeDBSearch(db,req.session.uid,req.session.ses,JSON.stringify(searchContent));
                    
                    await db.query(usql,[ses]);
                    await db.end();

                    socket.updMsg(req.session.ses);
                    res.end(JSON.stringify(feeds));
                })
                .catch(async (err) => {
                    console.error("Error fetching tweets: ",err);
                    await db.query(usql, [ses])
                    await db.end();
                    res.end("[]");
                });
        } catch (err){
            await db.query(usql, [ses]);
            await db.end();
            res.end("[]");
        }
    }
};

module.exports.trendings = async function(req, res){
    if(req.session.uid==null){
        res.end("[]");
        return;
    }
    let queryCountry = req.body["country"];
    let parsedData;
    fs.readFile("resources/data/country_woeids.json", "utf-8", (err,data) => {
        if (err){
            console.error("Error reading woeid file", err);
            res.end("[]");
            return;
        }
        try {
            parsedData = JSON.parse(data);
            let country = parsedData.find(c => c.place_name.toLowerCase() == queryCountry.toLowerCase()); 
            let woeid = country? country.woeid : 1;
            fetchTrends(woeid).then(function(response){
                res.end(JSON.stringify(response));
            });          
        } catch (err){
            console.error("Error fetching trends", err);
            res.end("[]");
        }
    })
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
    rClient.v2.userByUsername(data["user"])
        .then(userResponse => {
            let userId = userResponse.data.id;
            return rClient.v2.userTimeline(userId,{exclude: 'retweets'});
        })
        .then(response => {
            console.log(response);
            let arr = response.data.map(adapterTweetToFeed(null,inow));
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

async function fetchTrends(woeid){
    try{
        let params = new URLSearchParams({woeid: woeid});
        let response = await fetch(`${endpointTrends}?${params.toString()}`, {
                method: "GET",
                headers: {"x-api-key": apiKey}
            });
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        let data = await response.json();
        return data.trends;
    } catch {
        console.error("Error fetching trends:", error);
    }
}

async function fetchTweets(query, geo, qtype) {
    try {
        let allTweets = [];
        cursor = null;
        pageCount = 0;
        do{
            let params = new URLSearchParams({queryType: qtype, query: query, geocode: geo});
            if (cursor) {
                params.append("cursor", cursor);
            }
            let response = await fetch(`${endpointTweets}?${params.toString()}`, {
                method: "GET",
                headers: {"x-api-key": apiKey}
            });
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            let data = await response.json();
            if (data.tweets && data.tweets.length > 0) {
                if(allTweets.length == 0){
                    allTweets = data.tweets;
                } else {
                    allTweets = allTweets.concat(data.tweets);
                }
            } else {
                console.log("No tweets found.");
            }
            if (data.next_cursor) {
                cursor = data.next_cursor;
                pageCount++;
            } else {
                cursor = null;
                console.log("No more pages.");
            }
        } while (cursor && pageCount < 5);
        return allTweets;  
    } catch (error) {
        console.error("Error fetching tweets:", error);
    }
}

/**
 * Converts a tweet object to a feed object
 * @param gc geocode to be used as extra
 * @return Function - The function to wrap the feed object that represent the tweet
 */
var adapterTweetToFeed = function(gc,inow){
    var ss = "";
    if(gc!=null)
        ss = wktFromCoords(gc.split(",")[0],gc.split(",")[1]);
    return async function(tweet,i){
        let geoloc = null;
        let username = null;
        if(tweet.author){
            username = tweet.author.userName;
            try{
                let coords = await getGeoLatLng(tweet.author.location);
                if(coords){
                    geoloc = wktFromCoords(coords[0], coords[1]);
                }
            }catch(err){
                console.error("error fetching coords",err);
            }
        }
        return {
            id: +(tweet.id),
            descr: tweet.text.replace("\n", ""),
            author: id_tb,
            time: +(new Date(tweet.createdAt)),
            geom: geoloc,
            parentfeed: -1,
            extra: tweet.id + "|@" + username + "|" + ss + "|" + inow
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

var wktFromCoords = function(lat,lng){
    return "POINT("+lat+" "+lng+")";
};

var getGeoLatLng = async function(location){
    let username = 'jexexjzkrall';
    let geoApi = `https://secure.geonames.org/searchJSON?q=${encodeURIComponent(location)}&maxRows=1&username=${username}&lang=es`;
    let response = await fetch(geoApi);
    let data = await response.json();
    
    if (data.totalResultsCount > 0) {
        let place = data.geonames[0];
        return [parseFloat(place.lat), parseFloat(place.lng)];
    }
    return null;
}

/**
 * Adds a tweet feed to the database
 * @param tw The tweet feed object to be added
 * @param ses The session where the feed belongs to
 */
var addDBTweet = async function(db,tw,ses){
    var sql = "insert into feeds(descr,time,author,sesid,geom,extra) values($1,$2,$3,$4,$5,$6);";
    await db.query(sql,[tw.descr,new Date(tw.time),tw.author,ses,tw.geom,tw.extra]);
}

/**
 * Stores a search done to twitter api
 * @param uid the id of the user
 * @param ses the id of the current session
 * @param text the json stringfied text of the search
 */
var storeDBSearch = async function(db,uid,ses,text){
    var sql = "insert into history(uid,sesid,query) values($1,$2,$3)";
    await db.query(sql,[uid,ses,text]);
};