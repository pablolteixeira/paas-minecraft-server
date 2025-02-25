require("dotenv").config()
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const userRoutes = require("../routes/userRoutes");
const v0Routes = require("../routes/v0Routes");

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json())
app.use(cors())

// Routes
app.use("/api/v0", userRoutes);
app.use("/api/v0", v0Routes);

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(
    () => console.log("✅ Connected to MongoDB")
).catch(error => console.error("❌ MongoDB Connection Error:", error))

app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
})