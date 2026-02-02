# Technology Stack

This document outlines the core technologies and libraries used in the Easy Stones Website project.

## Frontend (Client-Side)
*   **[React](https://react.dev/):** The core JavaScript library for building the user interface.
*   **[Vite](https://vitejs.dev/):** The build tool and development server, providing fast hot-reloading and optimized builds.
*   **[React Router](https://reactrouter.com/):** Handles client-side navigation between pages (Sales, Admin, etc.).
*   **[Lucide React](https://lucide.dev/):** Provides the consistent icon set used throughout the application.
*   **[CSS Modules / Standard CSS](https://developer.mozilla.org/en-US/docs/Web/CSS):** Used for styling components and layouts.
*   **[SheetJS (xlsx)](https://docs.sheetjs.com/):** Handles Excel export functionality for reports.

## Backend (Server-Side)
*   **[Node.js](https://nodejs.org/):** The JavaScript runtime environment.
*   **[Express](https://expressjs.com/):** The web framework powering the REST API.
*   **[Multer](https://github.com/expressjs/multer):** Middleware for handling `multipart/form-data`, primarily for file uploads (images, PDFs).
*   **[Sharp](https://sharp.pixelplumbing.com/):** High-performance image processing library used for optimizing and resizing uploaded images.
*   **[Nodemailer](https://nodemailer.com/):** Module for sending emails (e.g., contact form submissions).

## Database & Authentication
*   **[MongoDB](https://www.mongodb.com/):** The NoSQL database used for storing data.
*   **[Mongoose](https://mongoosejs.com/):** Object Data Modeling (ODM) library for MongoDB and Node.js. It manages data relationships (e.g., embedding Visits within Customers).
    *   **Data Structure Note:** Visits are stored as embedded sub-documents within the `Customer` document.
*   **[JWT (JSON Web Token)](https://jwt.io/):** Used for secure, stateless authentication (login sessions).
*   **[Bcryptjs](https://github.com/dcodeIO/bcrypt.js):** Library for hashing passwords to ensure security.

## Development Tools
*   **[ESLint](https://eslint.org/):** specific linter to identify and report on patterns found in ECMAScript/JavaScript code.
