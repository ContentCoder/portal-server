/* 
 * server.js 
 * 
 * API server.
 * 
 * version: 0.0.1
 * create date: 2014.3.25
 * update date: 2014.3.25
 *
 */

var util    = require('util'),
    path    = require('path'),
    fs      = require('fs'),
    http    = require('http'),
    url     = require('url'),
    crypto  = require('crypto'),
		aws     = require('aws-sdk'),
		uit     = require(path.join(__dirname, 'modules/url-image-thumbnail/url-thumbnail.js'));
		quotes	= require(path.join(__dirname, 'modules/quotes/quotes.js'));

// load configuration
var config  = require(path.join(__dirname, 'config.json'));
util.log(JSON.stringify(config, null, 2));

// aws init
aws.config.loadFromPath(path.join(__dirname, 'awsconfig.json'));
var dynamodb = new aws.DynamoDB();

// launch server 
var port = process.env.PORT || config.PORT;
http.createServer(function(req, res) {
  util.log(req.method + ' ' + req.url);
  req.parsedUrl = url.parse(req.url, true);
  switch (req.method + req.parsedUrl.pathname) {
  case 'GET/image/thumbnail':
    getImageThumbnail(req, res);
    return;
	case 'GET/quotes':
		getQuotes(req, res);
		return;
  default:
    responseJSON(res, 404, {message: '404 Not Found'});
    return;
  }
}).listen(port);
util.log(util.format('API server running at %d port...', port));

/* 
 * Image thumbnail route.
 * 
 * Request: 
 *	Method: GET
 *	Path: /image/thumbnail
 *	Query String: 
 *		url: image url
 *    width: thumbnail width
 *    height: thumbnail height
 *    crop: crop method, 'Center' or 'North'
 *		apikey: API key
 *		expires: expire time
 * 
 * Response: 
 *	Error: 
 *		Status Code: 
 *      400 Bad Request
 *      500 Internal Server Error
 *    Content Type: application/json
 *    Body: error message
 *  Thumbnail File: 
 *    Status Code: 200 OK
 *		Content Type: image/*
 *		Body: thumbnail file
 */
function getImageThumbnail(req, res) {
  if (!req.parsedUrl.query.apikey 	|| 
			!req.parsedUrl.query.url 			|| 
			(!req.parsedUrl.query.width && !req.parsedUrl.query.height)) {
    responseJSON(res, 400, {message: '400 Bad Request'});
    return;
  }

	authenticate(req, function(succeed) {
		if (!succeed) {
			util.log('authenticate failed.');
			responseJSON(res, 401, {message: '401 Unauthorized'});
			return;
		}

		var options = {};
		options.width   = req.parsedUrl.query.width;
    options.height  = req.parsedUrl.query.height;
    options.crop    = req.parsedUrl.query.crop;
		uit.thumbnailObject(req.parsedUrl.query.url, options, function(err, data) {
			if (err) {
				responseJSON(res, 500, err);
				return;
			}

			var headers = {};
			headers['Content-Type']		= data.ContentType;
			headers['Content-Length']	= data.ContentLength;
			headers['ETag']						= data.ETag;
			headers['Last-Modified']	= data.LastModified;
			res.writeHead(200, headers);
			res.end(data.Body);

			var item = {};
			item.TableName             = config.THUMBTABLE;
			item.Item                  = {};
			item.Item.User             = {S: req.accessKey.User.S};
			item.Item.Time             = {N: new Date().getTime().toString()};
			item.Item.Url              = {S: req.parsedUrl.query.url};
			if (req.parsedUrl.query.width)
				item.Item.Width          = {N: req.parsedUrl.query.width.toString()};
			if (req.parsedUrl.query.height)
				item.Item.Height         = {N: req.parsedUrl.query.height.toString()};
			if (req.parsedUrl.query.crop)
				item.Item.Crop           = {S: req.parsedUrl.query.crop};
			dynamodb.putItem(item, function(err, data) {
				if (err) {
					util.log(JSON.stringify(err, null, 2));
				} else {
					util.log('done. ' + JSON.stringify(data, null, 2));
				}
			});   // dynamodb.putItem	
		});		// uit.thumbnailObject		
	});		// authenticate 
}

/* 
 * Quotes route.
 * 
 * Request: 
 *	Method: GET
 *	Path: /quotes
 * 
 * Response: 
 *	
 */
function getQuotes(req, res) {
	quotes.random(function(err, quote) {
		if (err) {
			responseJSON(res, 500, err);
		} else {
			response(res, 200, quote);
		}
	});		// quotes.random
}

function responseJSON(res, statusCode, msg) {
  res.writeHead(statusCode, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(msg));
  util.log(JSON.stringify(msg));
  return;
}

function authenticate(req, callback) {
  var item = {};
  item.TableName = config.AUTHTABLE;
  item.Key       = {};
  item.Key.ID    = {S: req.parsedUrl.query.apikey};
  dynamodb.getItem(item, function(err, accessKey) {
    if (err || !accessKey) {
      callback(false);
      return;
    }
		if (!accessKey.Item) {
			callback(false);
			return;
		}

    req.accessKey = accessKey.Item;
    if (!config.AUTHENTICATION) {
      callback(true);
      return;
    }

    var s = [ req.parsedUrl.pathname,
              req.parsedUrl.query.url,
              req.parsedUrl.query.width,
              req.parsedUrl.query.height,
              req.parsedUrl.query.crop,
              req.parsedUrl.query.apikey,
              req.parsedUrl.query.expires
            ].sort().join('');
    util.log(s);
    var signature = crypt.createHmac('sha1', req.accessKey.Secret.S).update(s).digest('base64');
    util.log(signature);
    if (signature == req.parsedUrl.query.signature) {
      var now = new Date().getTime();
      if (now > req.parsedUrl.query.expires) {
        callback(false);
      } else {
        callback(true);
      }
    } else {
      callback(false);
    }
    return;
  });   // dynamodb.getItem
}



