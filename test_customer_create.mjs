import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

// Mongoose schema definition exactly as Customer.js (simplified to reproduce the error)
const customerSchema = new mongoose.Schema({
    contactName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    company: String,
    phone: String,
    address: { street: String, city: String, state: String, zipCode: String },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    priceLevel: { type: Number, default: 1 },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    loginIps: { type: [String], default: [] },
    quickNote: String
}, { timestamps: true });

const CustomerModel = mongoose.model('TempCustomer', customerSchema, 'customers');

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        // Simulate backend payload mapping
        const payload = { "customerName": "", "company": "TestCompany", "address": { "street": "", "city": "", "state": "", "zipCode": "" }, "phone": "", "email": "", "notes": "", "lastVisit": null, "nextVisit": null, "status": "active", "tags": [] };

        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 8);
        const customerEmail = `sales_${timestamp}_${randomString}@temp-customer.com`;
        const customerPassword = 'Password123!';

        const newCustomer = new CustomerModel({
            contactName: payload.customerName || payload.company,
            email: customerEmail,
            password: customerPassword,
            company: payload.company,
            phone: payload.phone || '',
            address: {
                street: payload.address.street || '',
                city: payload.address.city || '',
                state: payload.address.state || '',
                zipCode: payload.address.zipCode || ''
            },
            quickNote: payload.notes || '',
            isVerified: true,
            priceLevel: 1,
            isActive: true
        });

        await newCustomer.save();
        console.log('Success! ID:', newCustomer._id);

        // Cleanup
        await CustomerModel.findByIdAndDelete(newCustomer._id);
    } catch (err) {
        console.error('Validation Error Details:', err.errors);
        console.error('Error Msg:', err.message);
    } finally {
        await mongoose.disconnect();
    }
}
run();
