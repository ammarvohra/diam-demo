import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import multer from "multer";
import { create } from "ipfs-http-client";
import fs from "fs";
import DiamanteHDWallet from "diamante-hd-wallet";
import axios from 'axios';
import FormData from 'form-data';
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
const ipfs = create({ url: "https://ipfs.io" });

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

  const TokenAsset = new Asset("AstroDollar", issuingKeys.publicKey());

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
        amount: "0.01",
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
  console.log("Distribution Key", distributionKeys.publicKey());

  const server = new Aurora.Server("https://diamtestnet.diamcircle.io/");

  // try {
  //   const response = await fetch(
  //     `https://friendbot.diamcircle.io?addr=${encodeURIComponent(
  //       distributionKeys.publicKey()
  //     )}`
  //   );
  //   const responseJSON = await response.json();
  //   console.log("SUCCESS! You have a new account :)\n", responseJSON);
  // } catch (e) {
  //   console.error("ERROR!", e);
  // }

  try {
    var parentAccount = await server.loadAccount(distributionKeys.publicKey()); //make sure the parent account exists on ledger
    const receivingKeys = Keypair.fromPublicKey("GDRW4SPRUQ6R7FEFR4UPUH5WABXX3SNLDJY32KWI52DSHGO5BKOOX3TT");
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
          startingBalance: "0.0001",
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

app.get("/Stream", async (req, res) => {
  try {
    // Choose one of the following streaming methods:

    // 1. Stream all transactions
    const allTxStream = streamAllTransactions();

    // 2. Stream transactions for a specific account (uncomment to use)
    // const accountId = 'YOUR_ACCOUNT_PUBLIC_KEY';
    // const accountTxStream = streamAccountTransactions(accountId);

    // 3. Stream with robust reconnection (uncomment to use)
    // const robustTxStream = createRobustStream(() => streamAllTransactions());

    // 4. Stream with filtering (uncomment to use)
    // const filteredTxStream = streamFilteredTransactions(multiOpFilter);

    // Setup graceful shutdown on process termination
    process.on("SIGINT", () => {
      console.log("Shutting down transaction streams...");
      closeStream(allTxStream);
      // closeStream(accountTxStream);
      // closeStream(robustTxStream);
      // closeStream(filteredTxStream);
      process.exit(0);
    });

    console.log("Streaming active. Press Ctrl+C to stop.");
  } catch (error) {
    console.error("Error in main function:", error);
  }
});

// Function to handle stream errors
function handleError(error) {
  console.error("Error in stream:", error);
  // You might implement reconnection logic here
}

// Function to close streams
function closeStream(stream) {
  if (stream) {
    stream.close();
    console.log("Stream closed");
  }
}

/*
  * Stream all transactions fromt he network
    * @returns { Object } The transaction stream object
      */
function streamAllTransactions() {
  console.log("Starting transactions stream for all transactions");
  const server = new Aurora.Server("https://diamtestnet.diamcircle.io/");

  const txStream = server
    .transactions()
    .cursor(16302905581637632) // Start from now // or paging token
    // .limit(200) // Optional limit
    .stream({
      onmessage: (tx) => {
        console.log("=== New Transaction ===");
        console.log(`ID: ${tx.id}`);
        console.log(`Source account: ${tx.source_account}`);
        console.log(`Created at: ${tx.created_at}`);
        console.log(`Fee charged: ${tx.fee_charged}`);
        console.log(`Operation count: ${tx.operation_count}`);
        console.log(`Memo type: ${tx.memo_type}`);
        console.log(`Paging Token: ${tx.paging_token}`);

        // If there's a memo, log it
        if (tx.memo && tx.memo !== "none") {
          console.log(`Memo: ${tx.memo}`);
        }

        // You can fetch the operations in this transaction for more details
        server
          .operations()
          .forTransaction(tx.id)
          .call()
          .then((ops) => {
            console.log(`Operations in transaction ${tx.id}:`);
            ops.records.forEach((op) => {
              console.log(`- Type: ${op.type}`);

              // Log specific details based on operation type
              switch (op.type) {
                case "payment":
                  console.log(`  Amount: ${op.amount} ${op.asset_type}`);
                  console.log(`  From: ${op.from}`);
                  console.log(`  To: ${op.to}`);
                  break;
                case "create_account":
                  console.log(`  Account: ${op.account}`);
                  console.log(`  Starting balance: ${op.starting_balance}`);
                  break;
                case "manage_sell_offer":
                case "manage_buy_offer":
                  console.log(`  Amount: ${op.amount}`);
                  console.log(`  Price: ${op.price}`);
                  console.log(`  Selling: ${op.selling_asset_type}`);
                  console.log(`  Buying: ${op.buying_asset_type}`);
                  break;
                // Add more cases as needed
              }
            });
          })
          .catch((err) => console.error("Error fetching operations:", err));
      },
      onerror: handleError,
    });

  return txStream;
}

//Create NFT
app.post("/CreateNewNft", upload.single("file"), async (req, res) => {
  try {
    const { assetNames, files, quantity } = req.body;

    if (assetNames.length !== files.length) throw new Error("Length Mismatch between asset names and files");

    const assetCIDs = await Promise.all(
      files.map(async (file) => {
        const cid = await uploadToPinata(file);
        return cid;
      })
    );
    const server = new Aurora.Server("https://diamtestnet.diamcircle.io/");

    //HeadNFT: Public: GAYOQNFMSRNZTYIPDZQR6S3S3ARENTFVDAHOJ2Y3PH72BEH4SWOUZDGX Private: SBXLQZFWI7Z3KM47YNM5NUTWAAJDK4LNYYV4HVAB6CZL76ABIGMZJNKJ
    //GenesisOG: Public: GDC5ZVFTNAJ333P5IDIQ7CQBAA4F4HKPVFQUD2WNMTKPZ3YFE24TRW7F Private: SB4MXWROQVBVIIFGNW77UIPKPYNMFR4F5H5OVETYUEQODPXIKOH7EPUM
    //GenesisP2A: Public: GD4537PETYLVFDOI6QPAMM2U62WGJ4C4UT7P62PKQTXQUQIIGC4ESVCN Private: SBKBI6OVATQIUQAGLDRCKYYTL7OC7H5PFMH2IJXCNVVZNNDONXOSRUAO
    // Keys for accounts to issue and receive the new asset
    const issuingKeys = Keypair.fromSecret(
      "SBKBI6OVATQIUQAGLDRCKYYTL7OC7H5PFMH2IJXCNVVZNNDONXOSRUAO"
    );
    //Dist account: Public: GCNE6ZBMQIUY5RSZWQ2WGHRMDV7KNYZDEVPAC44I44MBHNUBSNPK2RID Private: SAWF4X3PXNI4UXPN255BX5BSWHDGPNQA43FJ25VCLAVD44XZYWMYDWZB
    const distributionKeys = Keypair.fromSecret(
      "SAWF4X3PXNI4UXPN255BX5BSWHDGPNQA43FJ25VCLAVD44XZYWMYDWZB"
    );
    const issuerAccount = await server.loadAccount(issuingKeys.publicKey());
    const distAccount = await server.loadAccount(distributionKeys.publicKey());

    // Create NFT assets
    const newNFTs = assetNames.map((name) => new Asset(name, issuingKeys.publicKey()));

    let trustTransactionBuilder = new TransactionBuilder(distAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    });

    let trustlinesNeeded = false;

    // Iterate through each asset and check trustline
    for (let nft of newNFTs) {
      let hasTrustline = distAccount.balances.some(
        (line) => line.asset_code === nft.code && line.asset_issuer === nft.issuer
      );

      // If trustline is missing, add an operation
      if (!hasTrustline) {
        trustTransactionBuilder.addOperation(
          Operation.changeTrust({
            asset: nft,
          })
        );
        trustlinesNeeded = true;
      }
    }

    // If there are trustlines to create, build and submit the transaction
    if (trustlinesNeeded) {
      let trustTransaction = trustTransactionBuilder.setTimeout(100).build();

      trustTransaction.sign(distributionKeys);
      await server.submitTransaction(trustTransaction);
      console.log("Trustlines created successfully");
    } else {
      console.log("All trustlines already exist.");
    }

    // Store asset metadata
    let manageDataTransactionBuilder = new TransactionBuilder(issuerAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    });

    for (let index = 0; index < assetNames.length; index++) {
      manageDataTransactionBuilder.addOperation(
        Operation.manageData({
          name: assetNames[index],
          source: issuingKeys.publicKey(),
          value: assetCIDs[index],
        })
      );
    }
    let manageDataTx = manageDataTransactionBuilder.setTimeout(100).build();
    manageDataTx.sign(issuingKeys);
    await server.submitTransaction(manageDataTx);
    console.log("Manage Data Transaction Successful");

    //Payment Trasaction
    let paymentTransactionBuilder = new TransactionBuilder(issuerAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    });

    newNFTs.forEach((nft) => {
      paymentTransactionBuilder.addOperation(
        Operation.payment({
          asset: nft,
          destination: distributionKeys.publicKey(),
          amount: quantity,
        })
      );
    });
    let paymentTx = paymentTransactionBuilder.setTimeout(100).build();
    paymentTx.sign(issuingKeys);
    await server.submitTransaction(paymentTx);
    console.log("Transfer Data Transaction Successful");

    res.status(200).json({
      message: "Transaction Success",
      asset: newNFTs
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Error while doing operations" });
  }
});

app.get("/GetAccount", async (req, res) => {
  try {
    const server = new Aurora.Server("https://diamtestnet.diamcircle.io/");
    const { mnemonic } = req.body;
    console.log(mnemonic);
    // const mnemonic = "plunge bulb base wisdom video only rent year body surprise blade gain";
    // Keys for accounts to issue and receive the new asset
    const wallet = DiamanteHDWallet.fromMnemonic(mnemonic);

    console.log("Account Public Key", wallet.getPublicKey(0));
    console.log("Account Private Key", wallet.getSecret(0));
  } catch (error) {
    console.error("Error in  function:", error);
  }
});

app.get("/GetCID", async (req, res) => {
  try {
    const { hash } = req.body;
    console.log(hash);
    const decodedValue = Buffer.from(hash, "base64").toString("utf-8");
    console.log("CID of image", decodedValue);
  } catch (error) {
    console.error("Error in  function:", error);
  }
});

async function uploadToPinata(filePath) {
  const API_KEY = '9cb95851ecb818131ec3';
  const API_SECRET = '39bf17c15d382c38422daa23f704e7196507f5d9d05abc59a81ce4cad7dc6f0a';

  const url = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
  const formData = new FormData();

  formData.append('file', fs.createReadStream(filePath));

  const headers = {
    'pinata_api_key': API_KEY,
    'pinata_secret_api_key': API_SECRET,
    ...formData.getHeaders(),
  };

  try {
    const response = await axios.post(url, formData, { headers });
    console.log(`File uploaded successfully! CID: ${response.data.IpfsHash}`);
    return response.data.IpfsHash;
  } catch (error) {
    console.error('Error uploading file to Pinata:', error);
  }
}


//Create NFT
app.post("/CreateTrustLine", async (req, res) => {
  try {
    const { assetNames } = req.body;

    const server = new Aurora.Server("https://diamtestnet.diamcircle.io/");

    //HeadNFT: Public: GAYOQNFMSRNZTYIPDZQR6S3S3ARENTFVDAHOJ2Y3PH72BEH4SWOUZDGX Private: SBXLQZFWI7Z3KM47YNM5NUTWAAJDK4LNYYV4HVAB6CZL76ABIGMZJNKJ
    //GenesisOG: Public: GDC5ZVFTNAJ333P5IDIQ7CQBAA4F4HKPVFQUD2WNMTKPZ3YFE24TRW7F Private: SB4MXWROQVBVIIFGNW77UIPKPYNMFR4F5H5OVETYUEQODPXIKOH7EPUM
    //GenesisP2A: Public: GD4537PETYLVFDOI6QPAMM2U62WGJ4C4UT7P62PKQTXQUQIIGC4ESVCN Private: SBKBI6OVATQIUQAGLDRCKYYTL7OC7H5PFMH2IJXCNVVZNNDONXOSRUAO
    // Keys for accounts to issue and receive the new asset
    const issuingKeys = Keypair.fromSecret(
      "SBXLQZFWI7Z3KM47YNM5NUTWAAJDK4LNYYV4HVAB6CZL76ABIGMZJNKJ"
    );
    //Dist account: Public: GCNE6ZBMQIUY5RSZWQ2WGHRMDV7KNYZDEVPAC44I44MBHNUBSNPK2RID Private: SAWF4X3PXNI4UXPN255BX5BSWHDGPNQA43FJ25VCLAVD44XZYWMYDWZB
    const distributionKeys = Keypair.fromSecret(
      "SBYXUBAGUWNNIH7OQJ5TPMZY2QW3EQEQGQIJB2LOSTRZOEQ33RPI56UW"
    );
    const issuerAccount = await server.loadAccount(issuingKeys.publicKey());
    const distAccount = await server.loadAccount(distributionKeys.publicKey());

    // Create NFT assets
    const newNFTs = assetNames.map((name) => new Asset(name, issuingKeys.publicKey()));

    let trustTransactionBuilder = new TransactionBuilder(distAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    });

    let trustlinesNeeded = false;

    // Iterate through each asset and check trustline
    for (let nft of newNFTs) {
      let hasTrustline = distAccount.balances.some(
        (line) => line.asset_code === nft.code && line.asset_issuer === nft.issuer
      );

      // If trustline is missing, add an operation
      if (!hasTrustline) {
        trustTransactionBuilder.addOperation(
          Operation.changeTrust({
            asset: nft,
          })
        );
        trustlinesNeeded = true;
      }
    }

    // If there are trustlines to create, build and submit the transaction
    if (trustlinesNeeded) {
      let trustTransaction = trustTransactionBuilder.setTimeout(100).build();

      trustTransaction.sign(distributionKeys);
      await server.submitTransaction(trustTransaction);
      console.log("Trustlines created successfully");
    } else {
      console.log("All trustlines already exist.");
    }

    res.status(200).json({
      message: "Transaction Success"
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Error while doing operations" });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});