// src/services/googleApiAuthService.js
import fs from "fs/promises";
import path from "path";
import process from "process";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";

// Define Scopes

const SCOPE = ['https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly']

// fetch and store token from files
const TOKEN_PATH = path.join(process.cwd(), './src/credentials/token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), './src/credentials/credentials.json');

// this 3 method perform authentication jobs
// Read previsously authorized credentials from saved file
async function LoadSavedCredentialsIfExists(){
    try{
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    }catch(err){
        return null;
    }
}

//
async function saveCredentials(client){
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.web || keys.installed;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

//write and generate token file
async function authorize(){
    let client = await LoadSavedCredentialsIfExists();
    if(client){
        return client;
    }

    client = await authenticate({
        scopes : SCOPE,
        keyfilePath : CREDENTIALS_PATH,
    });

    if(client.credentials){
        await saveCredentials(client);
    }
    console.log('auth credentials:', client && client.credentials);
    return client;
};

// authorize().then(authClient => {
//   console.log(authClient.credentials.refresh_token);
// });

export { authorize };

