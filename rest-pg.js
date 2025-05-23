/**
 * Created by sergio on 09-02-16.
 */

var pg = require('pg');
//var qs = require('querystring');

function smartArrayConvert(params,ses,data,calc) {
    var arr = [];
    for(var i=0; i<params.sqlParams.length; i++){
        var p = params.sqlParams[i];
        //console.log(p);
        p = JSON.parse(p);
        if(p.type=="plain")
            arr.push(p.name);
        else if(p.type=="ses")
            arr.push(ses[p.name]);
        else if(p.type=="calc")
            arr.push(calc[p.name]);
        else
            arr.push(data[p.name]);
    }
    return arr;
}

/**
 * Returns a sql statement parameter
 * @param t type of parameter (plain, post or ses)
 * @param n name of the parameter.
 */
module.exports.sqlParam = function(t,n){
    return JSON.stringify({name: n, type: t});
};

/**
 * Execute a single sql statement with ok / err response.
 * @param params Parameters including:
 * <li> sql (required): String sql to be executed.
 * <li> dbcon (required): String of database connection.
 * <li> sesReqData: List of session required data.
 * <li> postReqData: List of post request required data.
 * <li> sqlParams: List of sql statement $ parameters.
 * <li> onStart: Function to be executed just before sql execution.
 * <li> onEnd: Function to be executed just before send end result.
 */
module.exports.execSQL = function(params){

    if(params.sql == null || params.sql == "" || params.dbcon == null || params.dbcon == "")
        return null;

    return async function(req,res){
        var ses;
        ses = req.session;
        //res.header("Content-type","application/json");
        if(params.sesReqData != null) {
            for(var i=0; i<params.sesReqData.length; i++){
                if(ses[params.sesReqData[i]]===null){
                    res.end('{"status":"err"}');
                    //console.log("No data provided");
                    return;
                }
            }
        }
        /*var postdata = "";
        req.on("data",function(chunk){
            postdata += chunk;
        });
        req.on("end",function(){*/
        var data = req.body;
        var calc = {};
        /*if(postdata!="")
            data = JSON.parse(postdata);*/
        if(params.postReqData != null) {
            for(var i=0; i<params.postReqData.length; i++){
                if(data[params.postReqData[i]]===null || data[params.postReqData[i]]===""){
                    res.end('{"status":"err"}');
                    //console.log("No data provided");
                    return;
                }
            }
        }
        var db = new pg.Client(params.dbcon);
        db.connect();
        var sql = "";
        if(params.onStart != null)
            sql = params.onStart(ses,data,calc) || params.sql;
        else
            sql = params.sql;
        var qry;
        try{
            if(params.sqlParams != null){
                var sqlarr = smartArrayConvert(params,ses,data,calc);
                qry = await db.query(sql,sqlarr);
            }
            else{
                qry = await db.query(sql);
            }
            if(params.onEnd != null){
                params.onEnd(req,res);
            }else{
                res.send('{"status":"ok"}');
            }
            res.end();
            db.end();
        } catch(error){
            console.error("error while executing query:", error);
        }
        //});
    }
};

/**
 * Execute a select single sql statement.
 * @param params Parameters including:
 * <li> sql (required): String sql to be executed.
 * <li> dbcon (required): String of database connection.
 * <li> sesReqData: List of session required data.
 * <li> postReqData: List of post request required data.
 * <li> sqlParams: List of sql statement $ parameters.
 * <li> onStart: Function to be executed just before sql execution.
 * <li> onEnd: Function to be executed just before send end result.
 * <li> onSelect: Function handled after sql statement is executed. It replaces the normal return behavior.
 */
module.exports.singleSQL = function(params){

    if(params.sql == null || params.sql == "" || params.dbcon == null || params.dbcon == "")
        return null;

    return function(req,res){
        var ses;
        ses = req.session;
        res.header("Content-type","application/json");
        if(params.sesReqData != null) {
            for(var i=0; i<params.sesReqData.length; i++){
                if(ses[params.sesReqData[i]]===null){
                    res.end('{"status":"err"}');
                    //console.log("No data provided");
                    return;
                }
            }
        }
       /* var postdata = "";
        req.on("data",function(chunk){
            postdata += chunk;
        });
        req.on("end",function(){
            var data = {};
            if(postdata!="")
                data = JSON.parse(postdata);*/
        var data = req.body;
        var calc = {};
        if(params.postReqData != null) {
            for(var i=0; i<params.postReqData.length; i++){
                if(data[params.postReqData[i]]===null || data[params.postReqData[i]]===""){
                    res.end('{"status":"err"}');
                    //console.log("No data provided");
                    return;
                }
            }
        }
        var db = new pg.Client(params.dbcon);
        db.connect();
        if(params.onStart != null)
            params.onStart(ses,data,calc);
        var sql = params.sql;
        var qry;
        if(params.sqlParams != null){
            var sqlarr = smartArrayConvert(params,ses,data,calc);
            qry = db.query(sql,sqlarr);
        }
        else{
            qry = db.query(sql);
        }
        var result = {};
        qry.then(function(response){
            response.rows.forEach(function(row){
                if (params.onSelect!=null) {
                    result = params.onSelect(row);
                } else {
                    result = row;
                }
            });
            if (params.onEnd!=null){
                params.onEnd(req,res,result);
            } else {
                result["status"] = "ok";
                res.end(JSON.stringify(result));
            }
            res.end();
            db.end();
        }).catch(function(error){
            console.error("Error while executing query:", error);
            res.status(500).end(JSON.stringify({status: "error", message: error.message}));
            db.end();
        });
        /*
        qry.on("row",function(row){
            if(params.onSelect!=null){
                result = params.onSelect(row);
            }
            else{
                result = row;
            }
        });
        qry.on("end",function(){
            if(params.onEnd != null)
                params.onEnd(req,res,result);
            else {
                result["status"] = "ok";
                res.end(JSON.stringify(result));
            }
            res.end();
            db.end();
        });
        */
        //});
    }
};

/**
 * Execute a select single sql statement.
 * @param params Parameters including:
 * <li> sql (required): String sql to be executed.
 * <li> dbcon (required): String of database connection.
 * <li> sesReqData: List of session required data.
 * <li> postReqData: List of post request required data.
 * <li> sqlParams: List of sql statement $ parameters.
 * <li> onStart: Function to be executed just before sql execution.
 * <li> onEnd: Function to be executed just before send end result.
 * <li> onRow: Function handled every fetched row. It replaces the normal row behavior.
 */
module.exports.multiSQL = function(params){

    if(params.sql == null || params.sql == "" || params.dbcon == null || params.dbcon == "")
        return null;

    return function(req,res){
        var ses;
        ses = req.session;
        res.header("Content-type","application/json");
        if(params.sesReqData != null) {
            for(var i=0; i<params.sesReqData.length; i++){
                if(ses[params.sesReqData[i]]===null){
                    res.end('[]');
                    //console.log("No data provided");
                    return;
                }
            }
        }
        /*var postdata = "";
        req.on("data",function(chunk){
            postdata += chunk;
        });
        req.on("end",function(){
            var data = {};
            if(postdata!="")
                data = JSON.parse(postdata);*/
            //console.log(postdata);
            //console.log(data);
        var data = req.body;
        var calc = {};
        if(params.postReqData != null) {
            for(var i=0; i<params.postReqData.length; i++){
                if(data[params.postReqData[i]]===null || data[params.postReqData[i]]===""){
                    res.end('[]');
                    //console.log("No data provided");
                    return;
                }
            }
        }
        var db = new pg.Client(params.dbcon);
        db.connect();
        if(params.onStart != null)
            params.onStart(ses,data,calc);
        var sql = params.sql;
        var qry;
        if(params.sqlParams != null){
            var sqlarr = smartArrayConvert(params,ses,data,calc);
            qry = db.query(sql,sqlarr);
        }
        else{
            qry = db.query(sql);
        }
        var arr = [];
        qry.then(function(response){
            response.rows.forEach(function(row){
                if (params.onRow!=null){
                    var k = params.onRow(row);
                    if(k!=null) arr.push(k);
                } else {
                    arr.push(row);
                }
            });
            if (params.onEnd!=null){
                params.onEnd(req,res,arr);
            } else {
                res.send(JSON.stringify(arr));
            }
            res.end();
            db.end();
        }).catch(function(error){
            console.error("Error while executing query:", error);
            res.status(500).json({status: "error", message: error.message});
            db.end();
        });
        /*
        qry.on("row",function(row){
            if(params.onRow!=null){
                var k = params.onRow(row);
                if(k!=null) arr.push(k);
            }
            else{
                arr.push(row);
            }
        });
        qry.on("end",function(){
            if(params.onEnd != null)
                params.onEnd(req,res,arr);
            else
                res.send(JSON.stringify(arr));
            res.end();
            db.end();
        });
        */
        //});
    }
};
