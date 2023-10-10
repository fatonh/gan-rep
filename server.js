const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const fs = require('fs-extra');
const path = require('path');
const { Readable } = require('stream');
const app = express();


const protocol = 'http';
const host = '127.0.0.1';
const port = '8080';
const server = `${protocol}://${host}:${port}`;

app.use(bodyParser.json());

// Authentication middleware
app.use((req, res, next) => {
    const authorizationHeader = req.headers['authorization'];
    console.log(authorizationHeader);
    // Check if the Authorization header is present and contains the expected token from index.js
    if (!authorizationHeader || authorizationHeader.split(' ')[1] !== 'dGhlc2VjcmV0dG9rZW4=') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // All good, continue
    next();
  });

// Load the addresses data from addresses.json into our local variable here.
let addressesData;

try {
  const addressesFile = fs.readFileSync('addresses.json', 'utf8');
  addressesData = JSON.parse(addressesFile);
} catch (error) {
  console.error('Error reading addresses.json:', error);
  addressesData = [];
}

// Get a city by tag
app.get('/cities-by-tag', async (req, res) => {
    try {
        const tag = req.query.tag;
        const isActive = req.query.isActive === 'true';

        // Filter the data based on tag and isActive
        const filteredCities = addressesData.filter((city) => {
          return city.tags.includes(tag) && city.isActive === isActive;
        });

        res.status(200).json({ cities: filteredCities });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
});

// Find the distance between two cities
app.get('/distance', async (req, res) => {
  try {
    const fromGuid = req.query.from;
    const toGuid = req.query.to;

    const fromCity = addressesData.find((city) => city.guid === fromGuid);
    const toCity = addressesData.find((city) => city.guid === toGuid );

    if (!fromCity || !toCity) {
      return res.status(400).json({error: 'City not found!'});
    }

    // calculate the distance from city to city using Haversine formula
    const distance = calculateHaversineDistance(
      fromCity.latitude,
      fromCity.longitude,
      toCity.latitude,
      toCity.longitude
    );

    // Respond with the result
    res.status(200).json({from: fromCity, to: toCity, unit: 'km', distance: distance});
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Define an object to store area results
const areaResults = {};

// Find all the cities within a specified distance
app.get('/area', async (req, res) => {
  try {
    const fromGuid= req.query.from;
    const distance = req.query.distance;

    // Find the "from" city based on the GUID
    const fromCity = addressesData.find((city) => city.guid === fromGuid);

    if (!fromCity) {
      return res.status(404).json({ error: 'City not found' });
    }


    // Get unique identifier, we use this uniqueId later to get the plling cites
    const uniqueId = '2152f96f-50c7-4d76-9e18-f7033bd14428';

    // Calculate distance from the "from" city to all other cities in the background
    calculateAndStoreCitiesWithinDistance(fromCity, distance, uniqueId);

    // Respond with a URL for polling the result
    res.status(202).json({ resultsUrl: `${server}/area-result/${uniqueId}` });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Endpoint for polling the result of cities within a specified distance
app.get('/area-result/:id', async (req, res) => {
  try {
    const id = req.params.id;

    // Check if the result is available in the areaResults object
    if (areaResults[id]) {
      // Return cities
      res.status(200).json({ cities: areaResults[id] });
    } else {
      // Result not yet available, respond with a status indicating it's still processing
      res.status(202).json({ status: 'Processing' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Download all cities
app.get('/all-cities', async (req, res) => {
  try {
    // Fetch all cities data
    const allCitiesData = addressesData;

    // Serialize the entire array of city objects as a JSON string and make it more Human readable
    const allCitiesJSON = JSON.stringify(allCitiesData, null, 2);

    // Set headers for the response
    res.setHeader('Content-disposition', 'attachment; filename=all-cities.json');
    res.setHeader('Content-type', 'application/json');

    // Send the JSON data as a response
    res.status(200).send(allCitiesJSON);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Calculate the Haversince Distance
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  // The Haversine Formula expressed Mathematically
  // a = sin²(Δφ/2) + cos φ1 ⋅ cos φ2 ⋅ sin²(Δλ/2)
  // c = 2 ⋅ atan2( √a, √(1−a) )
  // d = R ⋅ c

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * // convert degrees (lat1,lon1) into radians before using in trigonometric
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return Math.round(distance * 100) / 100;
}

// Function to calculate and store cities within the specified distance in the background
async function calculateAndStoreCitiesWithinDistance(fromCity, distance, uniqueId) {

    const citiesWithinDistance = addressesData.filter((city) => {
      // Exclude the "from" city itself
      if (city.guid === fromCity.guid) {
        return false;
      }

      const calculatedDistance = calculateHaversineDistance(
        fromCity.latitude,
        fromCity.longitude,
        city.latitude,
        city.longitude
      );

      return calculatedDistance <= distance;
    });

    // Store the result using the unique identifier
    areaResults[uniqueId] = citiesWithinDistance;
    console.log(areaResults);

}

function generateUniqueId(){
  return Math.random().toString(36).substring(2,15) + Math.random().toString(36).substring(2,15);
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
