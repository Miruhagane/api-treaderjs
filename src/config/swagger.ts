
import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API de Trading Multi-Broker',
      version: '1.0.0',
      description: 'Una API para interactuar con múltiples plataformas de trading como Binance y Capital.com.',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Servidor de desarrollo',
      },
    ],
  },
  apis: ['./src/index.ts', './src/capital.ts', './src/binance.ts'],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
