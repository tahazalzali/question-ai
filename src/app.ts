import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import routes from './routes';
import { requestLogger } from './utils/logger';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './config/swagger';
import path from 'path';

const app = express();

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { explorer: true }));

const staticDir = path.resolve(process.cwd(), 'public');
app.use(express.static(staticDir));
app.get('/', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));

app.use('/api', routes);

export default app;