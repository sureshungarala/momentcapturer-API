"use strict";

const path = require('path');
const fs = require('fs');
const Q = require("q");
const AWS = require('aws-sdk');
const sharp = require('sharp');

/**
 * C =>compress image, S=>store in s3, R=> record in dynamoDB
 */

module.exports.csr = (event, context, callback) => {

    let params = JSON.parse(event.body);
    const decoded = Buffer.from(params.image.replace(/^data:image\/\w+;base64,/, ""), 'base64');
    console.log(params);
    console.log('exists resolve ', fs.existsSync(path.resolve('/tmp/dist/')));
    if (!fs.existsSync(path.resolve('/tmp/dist/'))) {
        fs.mkdirSync(path.resolve('/tmp/dist/'));
    }
    console.log('exists resolve ', fs.existsSync(path.resolve('/tmp/dist/')));

    function compress(isHandheld) {
        let defer = Q.defer();
        sharp(decoded, {
            density: 515,
        }).jpeg({
            quality: 90,
            progressive: true,
            chromaSubsampling: '4:4:4',
            optimiseScans: true
        }).resize({   //aspect ratio 4:3
            width: isHandheld ? 500 : 950,
            height: isHandheld ? 375 : 712,
            fit: "contain",
            background: { r: 255, g: 255, b: 255, alpha: 0 }    //alpha is transparency '0' is 100% transp...so, rgb doesn't matter when alpha is 0
        }).toFile(path.resolve('/tmp/dist/', `sharp-${isHandheld ? 'handheld' : 'tablet'}.jpeg`), (err, info) => {
            if (err) {
                console.log(`Failed to compress for ${isHandheld ? 'handheld' : 'tablet'} with error `, err);
                defer.reject(err);
            } else {
                console.log(`Successfully compressed for ${isHandheld ? 'handheld' : 'tablet'} with info `, info);
                defer.resolve('');
            }
        });
        return defer.promise;
    }

    function respond(success) {
        const response = {
            statusCode: success ? 200 : 500,
            "headers": {
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({
                message: success ? "Executed CSR :)" : "Failed to execute CSR :(",
            }, null, 2)
        };
        callback(null, response);
    }

    function rmDir(dirPath) {
        let files = [];
        try { files = fs.readdirSync(dirPath); }
        catch (e) { console.error(e); return; }
        if (files.length > 0)
            for (let i = 0; i < files.length; i++) {
                let filePath = dirPath + '/' + files[i];
                if (fs.statSync(filePath).isFile())
                    fs.unlinkSync(filePath);
                else
                    rmDir(filePath);
            }
        fs.rmdirSync(dirPath);
    };

    async function executeCSR() {
        let processed;
        try {
            await compress(true);
            console.log('after compress.');
            processed = true;
        } catch (err) {
            console.log('CSR failed with error ', err);
            processed = false;
        } finally {
            console.log('Cleaning dest folder from /tmp...');
            rmDir('/tmp/dist/');
            console.log('Cleaned dest folder from /tmp.');
            respond(processed);
        }
    }

    executeCSR();
}