const { TwitterApi } = require("twitter-api-v2");
var pg = require('pg');
var twConfig = require("./passwords.js")("twConfig");
var twSecret = require("./passwords.js")("twSecret");
var conString = require("./passwords.js")("conString");
var twCount = require("./passwords.js")("twCount");
var pLimit = require("p-limit");
var mapKey = require("./passwords.js")("maps_key");
var fetch = require("node-fetch");


const apiKey = require("./passwords.js")("twApiIoKey"); 
const endpointTweets = "https://api.twitterapi.io/twitter/tweet/advanced_search";
const endpointTrends = "https://api.twitterapi.io/twitter/trends";
const fs = require("fs");

const path = require("path");
const filepath = path.join(__dirname, "resources/data/country_woeids.json");
var countries; 
fs.readFile(filepath, "utf-8", (err,data) => {
    if (err){
        console.error("Error reading woeid file", err);
        res.end("[]");
        return;
    }
    countries = JSON.parse(data);
})

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
            qType: data["qType"],
            fids: data["fids"],
            tCount: data["tCount"]
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
            fetchTweets(twOptions["q"], twOptions["geocode"], twOptions["qType"], twOptions["fids"], twOptions["tCount"])
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
    try {
        let country = countries.find(c => normalizeLocation(c.place_name) == normalizeLocation(queryCountry)); 
        let woeid = country? country.woeid : 1;
        fetchTrends(woeid).then(function(response){
            res.end(JSON.stringify(response));
        });          
    } catch (err){
        console.error("Error fetching trends", err);
        res.end("[]");
    }
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

async function fetchTweets(query, geo, qtype, fids, tCount) {
    try {
        let allTweets = [];
        let cursor = null;
        let pageCount = 0;
        let usedSpace = (fids)? fids.length : 0;
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
                if (fids) data.tweets = data.tweets.filter(t => !fids.includes(t.id));
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
        } while (cursor && !(allTweets.length + usedSpace >= 200) && (allTweets.length + 20 <= tCount));
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
        let username = null;
        let geoloc = null;
        let address = null;
        if(tweet.author){
            username = tweet.author.userName;
            loc = tweet.author.location.trim();
            if(loc){
                try{
                    let coords = await getGeoLatLng(tweet.author.location);
                    if(coords){
                        address = await cordToAddress(coords[0],coords[1]);
                        geoloc = wktFromCoords(coords[0], coords[1]);
                    }
                }catch(err){
                    console.error("error fetching coords",err);
                }
            }
        }
        return {
            id: +(tweet.id),
            descr: tweet.text.replace("\n", ""),
            author: id_tb,
            time: +(new Date(tweet.createdAt)),
            geom: geoloc,
            place: address,
            parentfeed: -1,
            extra: tweet.id + "|@" + username + "|" + ss + "|" + inow + "|" + tweet.author.location
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

var getGeoLatLng = async function(location){
    let username = 'jexexjzkrall';
    await sleep(200);
    for(let country of countries){
        if (normalizeLocation(country.place_name) == normalizeLocation(location)){
            let countryURL = `http://api.geonames.org/countryInfoJSON?country=${country.country_code}&username=${username}&lang=es`;
            let cResponse = await fetch(countryURL);
            let cData = await cResponse.json();
            await sleep(1000);
            if(cData.geonames && cData.geonames.length >0){
                let c = cData.geonames[0];
                let capCountry = encodeURIComponent(c.capital+","+c.countryCode)
                let capitalURL = `http://api.geonames.org/searchJSON?q=${capCountry}&maxRows=1&username=${username}&lang=es`;
                let capResponse = await fetch(capitalURL);
                let capData = await capResponse.json();
                let cap = capData.geonames[0];
                return [parseFloat(cap.lat), parseFloat(cap.lng)]; 
            }
            return null
        }
    }

    let geoApi = `http://api.geonames.org/searchJSON?q=${encodeURIComponent(location)}&maxRows=1&username=${username}&lang=es`;
    let response = await fetch(geoApi);
    let data = await response.json();
    if (data.totalResultsCount > 0 && data.geonames.length > 0) {
        let place = data.geonames[0];
        if(parseFloat(place.lat) == 0 && parseFloat(place.lng) == 0){
            return null
        }
        return [parseFloat(place.lat), parseFloat(place.lng)];
    }
    return null;
}

var cordToAddress = async function(lat,lng) {
    let url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${mapKey}&sensor=false`;
    try {
        let response = await fetch(url);
        let data = await response.json();
        if (data.status === "OK" && data.results.length >0) {
            let comps = data.results[0].address_components;
            let locality = comps.find(comp => comp.types.includes("locality"))?.long_name;
            let area_three = comps.find(comp => comp.types.includes("administrative_area_level_3"))?.long_name;
            let area_two = comps.find(comp => comp.types.includes("administrative_area_level_2"))?.long_name;
            let area_one = comps.find(comp => comp.types.includes("administrative_area_level_1"))?.long_name;
            let country = comps.find(comp => comp.types.includes("country"))?.long_name;
            let address = [locality, area_one, country].filter(Boolean).join(", ");
            return address;
        } else if (data.status === "ZERO_RESULTS"){
            return "No location available";
        } else {
            throw new Error("Error finding location: "+data.status+""+data.error_message);
        }
    } catch (err){
        console.log(err.message);
    }
};

var normalizeLocation = function(loc){
    loc = loc.toLowerCase();
    loc = loc.replace(/[^\p{L}\p{N}\s]/gu, "");
    loc = loc.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return loc.trim();
};

/**
 * Adds a tweet feed to the database
 * @param tw The tweet feed object to be added
 * @param ses The session where the feed belongs to
 */
var addDBTweet = async function(db,tw,ses){
    var sql = "insert into feeds(descr,time,author,sesid,geom,extra,place) values($1,$2,$3,$4,$5,$6,$7);";
    await db.query(sql,[tw.descr,new Date(tw.time),tw.author,ses,tw.geom,tw.extra,tw.place]);
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