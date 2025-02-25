const express = require("express");
const axios = require("axios");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// @route   GET /api/v0/server/
// @desc    Retrive server info
// @access  Public

router.get("/server", authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;

        const user = await User.findById(userId);

        if (!user.containerId) {
            res.status(200).json({ message: "Container not started yet", serverInfo: null })
        } else {
            const containerId = user.containerId;
            const inspect = await axios.get(`${process.env.DOCKER_HOST}/containers/${containerId}/json`);
            
            const status = inspect.data.State.Status;

            if (status == "running") {
                const fetchData = {
                    AttachStdin: true,
                    AttachStdout: true,
                    Cmd: ["rcon-cli", "/list"]
                }
                
                const fetchDataVersion = {
                    AttachStdin: true,
                    AttachStdout: true,
                    Cmd: ["/bin/sh", "-c", "ls | grep minecraft_server"]
                }
        
                const [execInstance, execInstanceVersion, stats, fs] = await Promise.all([
                    axios.post(`${process.env.DOCKER_HOST}/containers/${containerId}/exec`, fetchData),
                    axios.post(`${process.env.DOCKER_HOST}/containers/${containerId}/exec`, fetchDataVersion),
                    axios.get(`${process.env.DOCKER_HOST}/containers/${containerId}/stats?stream=false`),
                    axios.get(`${process.env.DOCKER_HOST}/containers/${ containerId}/json?size=true`)
                ]);
        
                const [serverMine, versionServerMine] = await Promise.all([
                    axios.post(`${process.env.DOCKER_HOST}/exec/${execInstance.data.Id}/start`, {
                        Detach: false,
                        Tty: true
                    }),
                    axios.post(`${process.env.DOCKER_HOST}/exec/${execInstanceVersion.data.Id}/start`, {
                        Detach: false,
                        Tty: true
                    }),
                ]);
                const regex = /(\d+).*?(\d+)/;
                const matches = serverMine.data ? serverMine.data.match(regex) : [];
        
                const currentPlayers = matches[1] ? matches[1] : null;
                const maxPlayers = matches[2] ? matches[2] : null;
                
                const regexVersion = /minecraft_server\.(\d+\.\d+\.\d+)\.jar/;
                const version = versionServerMine.data ? versionServerMine.data.match(regexVersion)[1] : null;
        
                const memoryStats = stats.data.memory_stats;
                const usedMemory = memoryStats.usage - memoryStats.stats.cache;
                const limitMemory = memoryStats.limit; 
                const cpuStats = stats.data.cpu_stats;
                const preCpuStats = stats.data.precpu_stats;
                const cpuDelta = cpuStats.cpu_usage.total_usage - preCpuStats.cpu_usage.total_usage;
                const systemCpuDelta = cpuStats.system_cpu_usage - preCpuStats.system_cpu_usage;
                const cpuUsage = (cpuDelta / systemCpuDelta) * cpuStats.online_cpus * 100.0;
                const normalizedCpuUsage = cpuUsage / cpuStats.online_cpus;

                const size = fs.data
                const assignedPort = inspect.data.NetworkSettings.Ports["25565/tcp"][0].HostPort;
                const startedAt = inspect.data.State.StartedAt;
        
                res.status(200).json({ message: "Container found sucessfully", 
                    serverInfo: {
                        containerId,
                        assignedPort,
                        startedAt,
                        currentPlayers,
                        maxPlayers,
                        version,
                        status,
                        cpuPercentage: normalizedCpuUsage,
                        memoryUsed: usedMemory,
                        memoryMax: limitMemory,
                        diskUsed: size.SizeRw,
                        diskMax: size.SizeRootFs,
                    } 
                });
            } else {
                res.status(200).json({ message: "Container is not running", serverInfo: {
                    containerId
                } });
            }
        }
    } catch (error) {
        console.log(error.stack)
        console.error("Error fetching container data: ", error.response?.data || error.message);
    }
});

// @route   POST /api/v0/create
// @desc    Create and start a new container
// @access  Public
router.post("/create", authMiddleware, async (req, res) => {
    try {
        const containerData = {
            Image: "itzg/minecraft-server",
            HostConfig: {
                PortBindings: { "25565/tcp" : [{ HostPort: "" }] },
                Memory: 3221225472,     // 3GB in bytes
                MemorySwap: 3221225472,
            },
            Tty: true,
            OpenStdin: true,
            Env: [
                "EULA=true"
            ]
        };

        const userId = req.user.userId;

        const user = await User.findById(userId);

        if (user.containerId) {
            return res.status(400).json({ messsage: "Container already created" });
        }

        const response = await axios.post(`${process.env.DOCKER_HOST}/containers/create`, containerData);
        const containerId = response.data.Id;
        
        await axios.post(`${process.env.DOCKER_HOST}/containers/${containerId}/start`);

        const inspect = await axios.get(`${process.env.DOCKER_HOST}/containers/${containerId}/json`);
        const assignedPort = inspect.data.NetworkSettings.Ports["25565/tcp"][0].HostPort;
        
        await User.findByIdAndUpdate(
            userId,
            { containerId },
            { new: true }
        );

        res.status(201).json({ 
            message: "Container created and started", 
            containerId, 
            assignedPort 
        });
    } catch (error) {
        console.error("Error creating container: ", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to create container", details: error.response?.data || error.message });
    }
});

// @route   POST /api/v0/start/:id
// @desc    Start container
// @access  Public
router.post("/start/:id", authMiddleware, async (req, res) => {
    const containerId = req.params.id;

    const userId = req.user.userId;

    const user = await User.findById(userId);

    if (user.containerId != containerId) {
        return res.status(400).json({ messsage: "Not allowed to modify this container" });
    }

    try {
        await axios.post(`${process.env.DOCKER_HOST}/containers/${containerId}/start`);

        res.json({ message: "Container started sucessfully", containerId });
    } catch (error) {
        console.error("Error starting container:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to start container", details: error.response?.data || error.message });
    }
})

// @route   POST /api/v0/pause/:id
// @desc    Pause container
// @access  Public
router.post("/pause/:id", authMiddleware, async (req, res) => {
    const containerId = req.params.id;

    const userId = req.user.userId;

    const user = await User.findById(userId);

    if (user.containerId != containerId) {
        return res.status(400).json({ messsage: "Not allowed to modify this container" });
    }

    try {
        await axios.post(`${process.env.DOCKER_HOST}/containers/${containerId}/pause`);

        res.json({ message: "Container paused sucessfully", containerId });
    } catch (error) {
        console.error("Error pausing container:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to pause container", details: error.response?.data || error.message });
    }
})

// @route   POST /api/v0/unpause/:id
// @desc    Unpause container
// @access  Public
router.post("/unpause/:id", authMiddleware, async (req, res) => {
    const containerId = req.params.id;

    const userId = req.user.userId;

    const user = await User.findById(userId);

    if (user.containerId != containerId) {
        return res.status(400).json({ messsage: "Not allowed to modify this container" });
    }

    try {
        await axios.post(`${process.env.DOCKER_HOST}/containers/${containerId}/unpause`);

        res.json({ message: "Container unpaused sucessfully", containerId });
    } catch (error) {
        console.error("Error unpausing container:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to unpause container", details: error.response?.data || error.message });
    }
})

// @route   POST /api/v0/restart/:id
// @desc    Restart container
// @access  Public
router.post("/restart/:id", authMiddleware, async (req, res) => {
    const containerId = req.params.id;

    const userId = req.user.userId;

    const user = await User.findById(userId);

    if (user.containerId != containerId) {
        return res.status(400).json({ messsage: "Not allowed to modify this container" });
    }

    try {
        await axios.post(`${process.env.DOCKER_HOST}/containers/${containerId}/restart`);

        res.json({ message: "Container restarted sucessfully", containerId });
    } catch (error) {
        console.error("Error restarting container:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to restart container", details: error.response?.data || error.message });
    }
})

// @route   POST /api/v0/delete/:id
// @desc    Delete container
// @access  Public
router.delete("/delete/:id", authMiddleware, async (req, res) => {
    const containerId = req.params.id;

    const userId = req.user.userId;

    const user = await User.findById(userId);

    if (user.containerId != containerId) {
        return res.status(400).json({ messsage: "Not allowed to modify this container" });
    }

    try {
        await axios.post(`${process.env.DOCKER_HOST}/containers/${containerId}/stop`);
        await axios.delete(`${process.env.DOCKER_HOST}/containers/${containerId}`);
        await User.findByIdAndUpdate(
            userId,
            { $unset: { ["containerId"]: "" } },
            { new: true }
        );

        res.json({ message: "Container deleted sucessfully", containerId });
    } catch (error) {
        console.error("Error deleting container:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to delete container", details: error.response?.data || error.message });
    }
});

module.exports = router