const mongoose = require("mongoose")

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, require: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true, minlength: 6 },
    containerId: { type: String, required: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", UserSchema);