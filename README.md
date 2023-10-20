# Server for stogacs.club ![Banner](./banner.png)

> **Note:**  
> This is the repository that handles dynamic features for the Conestoga Computer Science Club's website. It should be maintained by a member of the current club leadership, and everybody is welcome to contribute! Check out the site's [repository](https://github.com/stogacs/website) or the [actual site](https://stogacs.club).

## Instructions

To get started, clone this repository using the following command:

```bash
git clone https://github.com/stogacs/Website-Backend
```

After cloning the repository, you need to make some configurations to set up the server.

### Prerequisites

#### .env File

- Rename the `.env.example` file to `.env`.
- Replace the sample values in the `.env` file with actual values from the Discord Developer Portal or generate new ones as needed.

#### config.json File

- Rename the `config.json.example` file to `config.json`.
- Replace the sample values in the `config.json` file with actual values from the Discord Developer Portal or generate new ones as needed.
- If you have an SSL certificate, make sure to point the three components of your SSL certificate to the files on your filesystem. If you don't have an SSL certificate, you can generate a free one with [Let's Encrypt](https://letsencrypt.org/).
- Ensure that the `port` value for HTTPS is set to `443` to avoid potential issues with school firewalls. Please note that using HTTPS is required for the server to function properly; otherwise, it might be blocked by the client's browser.

## Setting Up (The) Shop

The data for the shop is stored in the `data` folder. The structure of the `data` folder is as follows:

- `data`
  - `store.json`
  - `users.json`
  - `assets`
    - `shekels_user.png` (User icon for webhooks)
    - `shop_0.png`
    - `shop_1.png` (An image for each item in the shop with the `has_image` flag set to true)

If you don't have any data, you'll want to create new `store.json` and `user.json` files. Below is an example of a `store.json` file with two items:

#### Example store.json

```json
{
  "items": {
    "0": {
      "hasImg": true,
      "id": 0,
      "title": "Shekel Multiplier (2x)",
      "description": "For the next 14 days, receive twice the shekels.",
      "price": 35,
      "max_quantity": 1,
      "type": "MULTI",
      "effect": [
        {
          "type": "multiplier",
          "value": 2
        }
      ],
      "expires_after": 1209600000
    },
    "1": {
      "hasImg": true,
      "id": 1,
      "title": "Choose Your Candy",
      "description": "Pick the next candy to be purchased for the club. Must be approved by leadership.",
      "price": 15,
      "type": "MANUAL",
      "last_purchase_stamp": null
    }
  }
}
```

The `expires_after` is an optional property that defines how long the item will remain in a user's inventory before being removed (it is a timestamp in milliseconds). The `expires_at` is an optional property that defines when the item will be removed from the store (it's a UNIX timestamp in milliseconds). You can generate timestamps with tools like [Epoch Converter](https://www.epochconverter.com/).

> **Info:**  
> This file contains properties that are not currently used and are reserved for future features.

#### Example users.json

```json
[
  {
    "name": "User Two",
    "id": "c91a57ef-eb30-4f53-b56c-5f9f4c237404",
    "admin": false,
    "Shekels": 10,
    "email": "example@example.com",
    "displayName": "Ella Fotzeu",
    "tokens": []
  },
  {
    "name": "User Two",
    "id": "d8a468de-249d-42f2-8b77-8f904e3d399c",
    "admin": false,
    "Shekels": 20,
    "email": "example2@example.com",
    "discordID": "123456789012345678",
    "displayName": "",
    "tokens": []
  }
]
```

These are two users who have not signed in via Discord. The `tokens` property is used to store sessions. The `discordID` is an optional property to assist in identifying users who have signed in via Discord. If this is not present when the user does sign in via Discord, they will be asked to enter their name, and they will be matched to the user with the same name, or a new user will be created.

The `admin` property allows the user to modify shekel balances and add/remove users.

### Running the Server

Once you've configured the server, you must install node modules with the following command:

```bash
npm i
```

After installing the node modules, you can run the server with the following command:

```bash
npm run serve
```

> **Info:**  
> For hosting the server, you can use a program like [pm2](https://pm2.keymetrics.io/) to run the server on startup and keep it running.

## Contributing

All pull requests are welcome.

## License

[MIT License](https://choosealicense.com/licenses/mit/)
