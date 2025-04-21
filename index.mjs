import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import multer from "multer";
import { create } from "ipfs-http-client";
import {
  Keypair,
  BASE_FEE,
  TransactionBuilder,
  Aurora,
  Networks,
  Operation,
  Asset,
} from "diamnet-sdk";

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(cors()); // Enable CORS for all routes

// Configure multer to use memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Create an IPFS client
const ipfs = create({ url: "https://uploadipfs.diamcircle.io" });

app.use(cors());
app.use(express.static("public"));

app.post("/CreateNft", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      throw new Error("No file uploaded");
    }

    // The file is available in req.file.buffer
    const fileContent = req.file.buffer;
    const result = await ipfs.add(fileContent);
    console.log("File uploaded to IPFS with CID:", result.cid.toString());
    const metadata = { cid: result.cid.toString() };

    const server = new Aurora.Server("https://diamtestnet.diamcircle.io/");

    // Keys for accounts to issue and receive the new asset
    const issuingKeys = Keypair.fromSecret(
      "SDCORBWCO3D53EJIX6A7WXPNQJJNHOJAIRXYRFKESN4IH6ZNRKWWDKPI"
    );
    const receivingKeys = Keypair.fromSecret(
      "SC2O6MJQVULBDONQJVAPL6A4KQYCWKY67ZFZLDOPSZ7YS7Y57LANZ5VE"
    );

    // Create an object to represent the new asset
    const astroDollar = new Asset("headnft11", issuingKeys.publicKey());

    // First, the receiving account must trust the asset
    server
      .loadAccount(receivingKeys.publicKey())
      .then(function (receiver) {
        var transaction = new TransactionBuilder(receiver, {
          fee: 100,
          networkPassphrase: Networks.TESTNET,
        })
          // The `changeTrust` operation creates (or alters) a trustline
          // The `limit` parameter below is optional
          .addOperation(
            Operation.changeTrust({
              asset: astroDollar,
              limit: "1000",
            })
          )
          // setTimeout is required for a transaction
          .setTimeout(100)
          .build();
        transaction.sign(receivingKeys);
        return server.submitTransaction(transaction);
      })
      .then(console.log)
      
      // Second, the issuing account holding the CID of Asset
      .then(function () {
        return server.loadAccount(issuingKeys.publicKey());
      })
      .then(function (issuer) {
        var transaction = new TransactionBuilder(issuer, {
          fee: 100,
          networkPassphrase: Networks.TESTNET,
        })
        .addOperation(
          Operation.manageData({
            name: "headnft11",
            source: issuingKeys.publicKey(),
            value: result.cid.toString(),
          })
        )
        // setTimeout is required for a transaction
        .setTimeout(100)
        .build();
        transaction.sign(issuingKeys);
        return server.submitTransaction(transaction);
      })
      .then(console.log)
      
      // Third, the issuing account actually sends a payment using the asset
      .then(function () {
        return server.loadAccount(issuingKeys.publicKey());
      })
      .then(function (issuer) {
        var transaction = new TransactionBuilder(issuer, {
          fee: 100,
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(
            Operation.payment({
              destination: receivingKeys.publicKey(),
              asset: astroDollar,
              amount: "10",
            })
          )
          // setTimeout is required for a transaction
          .setTimeout(100)
          .build();
        transaction.sign(issuingKeys);
        return server.submitTransaction(transaction);
      })
      .then(console.log)
      .catch(function (error) {
        console.error("Error!", error);
      });
    res.status(200).json({
      message: "Asset creation request received",
      cid: result.cid.toString(),
    });
  } catch (error) {
    console.error("Error uploading file to IPFS and creating asset:", error);
    res.status(500).json({ error: "Error uploading file to IPFS and creating asset" });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});