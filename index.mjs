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


//Create NFT
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


//Transfer the token to another user
app.post("/TransferNft", async (req, res) => {
  const issuingKeys = Keypair.fromSecret(
    "SDCORBWCO3D53EJIX6A7WXPNQJJNHOJAIRXYRFKESN4IH6ZNRKWWDKPI"
  );
  const distributionKeys = Keypair.fromSecret(
    "SC2O6MJQVULBDONQJVAPL6A4KQYCWKY67ZFZLDOPSZ7YS7Y57LANZ5VE"
  );
  const receivingKeys = Keypair.fromSecret("SB2CNTS7OWU7HDQONK65V7KIHKK3LDN4AVZDGZOBA6HIFAYJLBFOSI5N");

  const server = new Aurora.Server("https://diamtestnet.diamcircle.io/");

  const TokenAsset = new Asset("headnft11", issuingKeys.publicKey());

  // Load the user's account data from the Diamnet server
  const distAccount = await server.loadAccount(distributionKeys.publicKey());

  // Check if the user has an existing trustline for the token asset
  const recvAccount = await server.loadAccount(receivingKeys.publicKey());
  let hasTrustline = false;
  for (let line of recvAccount.balances) {
    if (
      line.asset_code === TokenAsset.code &&
      line.asset_issuer === TokenAsset.issuer
    ) {
      hasTrustline = true;
      break;
    }
  }

  //Create Trustline
  if (!hasTrustline) {
    const trustTransaction = new TransactionBuilder(recvAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.changeTrust({
          asset: TokenAsset,
        })
      )
      .setTimeout(100)
      .build();

    // Sign and submit the trustline transaction
    trustTransaction.sign(receivingKeys);
    await server.submitTransaction(trustTransaction);
    console.log("Trustline created successfully");
  }
  console.log("Trustline Done");

  // Build the transaction for the swap operation
  const transaction = new TransactionBuilder(distAccount, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: receivingKeys.publicKey(),
        // Because Diamante allows transaction in many currencies, you must
        // specify the asset type. The special "native" asset represents Lumens.
        asset: TokenAsset,
        amount: "1",
      })
    )
    .setTimeout(100)
    .build();

  // Sign the transaction
  transaction.sign(distributionKeys);

  // Submit the transaction to the Diamnet server
  try {
    const result = await server.submitTransaction(transaction);
    console.log("Swap successful:", result.hash);
    return { success: true, hash: result.hash }; // Return success and transaction hash
  } catch (error) {
    console.error("Swap failed:", error);
    return { success: false, error: error.message }; // Return failure and error message
  }

});


//Fund the account
app.post("/FundAccount", async (req, res) => {
  const issuingKeys = Keypair.fromSecret(
    "SDCORBWCO3D53EJIX6A7WXPNQJJNHOJAIRXYRFKESN4IH6ZNRKWWDKPI"
  );
  const distributionKeys = Keypair.fromSecret(
    "SC2O6MJQVULBDONQJVAPL6A4KQYCWKY67ZFZLDOPSZ7YS7Y57LANZ5VE"
  );

  const server = new Aurora.Server("https://diamtestnet.diamcircle.io/");

  try {
    const response = await fetch(
      `https://friendbot.diamcircle.io?addr=${encodeURIComponent(
        distributionKeys.publicKey()
      )}`
    );
    const responseJSON = await response.json();
    console.log("SUCCESS! You have a new account :)\n", responseJSON);
  } catch (e) {
    console.error("ERROR!", e);
  }

  try {
    var parentAccount = await server.loadAccount(distributionKeys.publicKey()); //make sure the parent account exists on ledger
    const receivingKeys = Keypair.fromPublicKey("GAQ46WMFDGGXP2BV7K63EOCEBBA2ENGWHROR2IWCWDVP4BCKNZ5OOOPE");
    //create a transacion object.
    var createAccountTx = new TransactionBuilder(parentAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    });
    //add the create account operation to the createAccountTx transaction.
    createAccountTx = await createAccountTx
      .addOperation(
        Operation.createAccount({
          destination: receivingKeys.publicKey(),
          startingBalance: "0.0000001",
        })
      )
      .setTimeout(180)
      .build();
    //sign the transaction with the account that was created from friendbot.
    await createAccountTx.sign(distributionKeys);
    //submit the transaction
    let txResponse = await server
      .submitTransaction(createAccountTx)
      // some simple error handling
      .catch(function (error) {
        console.log("there was an error");
        console.log(error.response);
        console.log(error.status);
        console.log(error.extras);
        return error;
      });
    console.log(txResponse);
    console.log("Created the new account", receivingKeys.publicKey());
  } catch (e) {
    console.error("ERROR!", e);
  }

});


app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});