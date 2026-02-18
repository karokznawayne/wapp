# Social Conversation Tool Prototype

A full-stack social conversation tool (like WhatsApp) built with Node.js, Express, SQLite, and Vanilla JS/CSS.

## Features

- **User Accounts**: Register, Login, MFA (TOTP).
- **Social Graph**: Friend requests, Mutual follow connection.
- **Groups**: Create groups, Join requests, Admin approval.
- **Messaging**: Direct and Group messaging.
- **Admin Panel**: Role-based access to view stats and users.
- **UI**: Modern Glassmorphism design.

## Setup Instructions

### Prerequisites

- Node.js (v18+)
- npm

### Local Installation

1.  Clone or download the project.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the server:
    ```bash
    npm start
    ```
4.  Open `http://localhost:3000` in your browser.

### Development

- Run `npm run dev` to start with nodemon.

### SQLite Database

- The database `database.sqlite` is created automatically in the `server` folder upon first run.

## Deployment on Vercel

1.  Push the code to a GitHub repository.
2.  Import the project into Vercel.
3.  Vercel will detect the settings from `vercel.json`.
4.  Deploy.

> **Important Note for Vercel**:
> This prototype uses **SQLite**, which is a file-based database. On Vercel (Serverless Functions), the filesystem is ephemeral.
> **Data will not persist** between deployments or after functions go cold.
> For a production deployment on Vercel, you should switch the database to a cloud solution like Vercel Postgres, Turso, or Supabase. Code changes would be minimal (mainly in `server/database.js`).

## Usage Guide

1.  **Register** a new account. The first user registered becomes the **Admin**.
2.  **Scan QR Code** with Google Authenticator (or skip if not enforcing strict MFA).
3.  **Search** for other users and send friend requests.
4.  **Create Groups** and invite others (they request to join).
5.  **Admin** can view stats via the "Admin Panel" button in the sidebar (visible only to admins).
