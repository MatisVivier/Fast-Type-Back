import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'http';
import health from './routes/health.js';
import texts from './routes/texts.js';
import auth from './routes/auth.js';
import soloRoutes from './routes/solo.js';
import { attachSockets } from './sockets.js';
import accountRoutes from './routes/account.js';


const app = express();
const PORT = process.env.PORT || 3001;


app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());


// Routes REST
app.use('/api', health);
app.use('/api', texts);
app.use('/api', auth);
app.use('/api', soloRoutes);
app.use('/api', accountRoutes);



const server = http.createServer(app);
attachSockets(server, process.env.CORS_ORIGIN);


server.listen(PORT, () => {
console.log(`✅ Server running on http://localhost:${PORT}`);
});