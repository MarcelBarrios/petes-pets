const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const Upload = require('s3-uploader');
const mailer = require('../utils/mailer');

console.log("S3 Bucket from .env:", process.env.S3_BUCKET);

const client = new Upload(process.env.S3_BUCKET, {
  aws: {
    path: 'pets/avatar',
    region: process.env.S3_REGION,
    acl: 'public-read',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  },
  cleanup: {
    versions: true,
    original: true
  },
  versions: [{
    maxWidth: 400,
    aspect: '16:10',
    suffix: '-standard'
  }, {
    maxWidth: 300,
    aspect: '1:1',
    suffix: '-square'
  }]
});

// MODELS
const Pet = require('../models/pet');

// PET ROUTES
module.exports = (app) => {

  // INDEX PET => index.js

  // NEW PET
  app.get('/pets/new', (req, res) => {
    res.render('pets-new');
  });

  // routes/pets.js - NEW CODE
  app.post('/pets', upload.single('avatar'), (req, res, next) => {
    // First, check if a file was uploaded
    if (!req.file) {
      // If not, return an error
      return res.status(400).send({ err: "No file uploaded." });
    }

    // If a file was uploaded, let's upload it to S3
    client.upload(req.file.path, {}, function (err, versions, meta) {
      if (err) {
        console.error("S3 Upload Error:", err);
        return res.status(400).send({ err: err });
      }

      // The upload was successful, now create and save the pet
      const pet = new Pet(req.body);

      // Get the base URL from the S3 response
      const urlArray = versions[0].url.split('-');
      urlArray.pop();
      const url = urlArray.join('-');
      pet.avatarUrl = url;

      // Save the pet to the database
      pet.save()
        .then(savedPet => {
          // Send the saved pet back to the client
          res.send({ pet: savedPet });
        })
        .catch(saveErr => {
          console.error("Database Save Error:", saveErr);
          res.status(500).send({ err: saveErr });
        });
    });
  });

  // SHOW PET
  app.get('/pets/:id', (req, res) => {
    Pet.findById(req.params.id).exec((err, pet) => {
      res.render('pets-show', { pet: pet });
    });
  });

  // EDIT PET
  app.get('/pets/:id/edit', (req, res) => {
    Pet.findById(req.params.id).exec((err, pet) => {
      res.render('pets-edit', { pet: pet });
    });
  });

  // UPDATE PET
  app.put('/pets/:id', (req, res) => {
    Pet.findByIdAndUpdate(req.params.id, req.body)
      .then((pet) => {
        res.redirect(`/pets/${pet._id}`)
      })
      .catch((err) => {
        // Handle Errors
      });
  });

  // DELETE PET
  app.delete('/pets/:id', (req, res) => {
    Pet.findByIdAndRemove(req.params.id).exec((err, pet) => {
      return res.redirect('/')
    });
  });

  // SEARCH
  app.get('/search', function (req, res) {
    Pet
      .find(
        { $text: { $search: req.query.term } },
        { score: { $meta: "textScore" } }
      )
      .sort({ score: { $meta: 'textScore' } })
      .limit(20)
      .exec(function (err, pets) {
        if (err) { return res.status(400).send(err) }

        if (req.header('Content-Type') == 'application/json') {
          return res.json({ pets: pets });
        } else {
          return res.render('pets-index', { pets: pets, term: req.query.term });
        }
      });
  });

  // PURCHASE
  app.post('/pets/:id/purchase', (req, res) => {
    console.log(req.body);
    // Set your secret key: remember to change this to your live secret key in production
    // See your keys here: https://dashboard.stripe.com/account/apikeys
    var stripe = require("stripe")(process.env.PRIVATE_STRIPE_API_KEY);

    // Token is created using Checkout or Elements!
    // Get the payment token ID submitted by the form:
    const token = req.body.stripeToken; // Using Express

    // req.body.petId can become null through seeding,
    // this way we'll insure we use a non-null value
    let petId = req.body.petId || req.params.id;

    Pet.findById(petId).exec((err, pet) => {
      if (err) {
        console.log('Error: ' + err);
        res.redirect(`/pets/${req.params.id}`);
      }
      const charge = stripe.charges.create({
        amount: pet.price * 100,
        currency: 'usd',
        description: `Purchased ${pet.name}, ${pet.species}`,
        source: token,
      }).then((chg) => {
        // Convert the amount back to dollars for ease in displaying in the template
        const user = {
          email: req.body.stripeEmail,
          amount: chg.amount / 100,
          petName: pet.name
        };
        // Call our mail handler to manage sending emails
        mailer.sendMail(user, req, res);
      })
        .catch(err => {
          console.log('Error: ' + err);
        });
    })
  });

}

