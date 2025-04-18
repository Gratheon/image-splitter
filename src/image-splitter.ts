import {ApolloServer} from "apollo-server-fastify"; // Remove BaseContext import
import {
    ApolloServerPluginDrainHttpServer,
    ApolloServerPluginLandingPageGraphQLPlayground,
} from "apollo-server-core";
import { GraphQLRequestListener } from "apollo-server-plugin-base"; // Import from plugin-base
import fastify from "fastify";
import fastifyMultipart from "fastify-multipart"; // Import fastify-multipart
import {buildSubgraphSchema} from "@apollo/federation";
import {processRequest} from "graphql-upload"; // Re-import processRequest
import jwt from "jsonwebtoken";
import gql from "graphql-tag";

import orchestrator from "./workers/orchestrator";
import {schema} from "./graphql/schema";
import {resolvers} from "./graphql/resolvers";
import {initStorage} from "./models/storage";
import {ensureBucketExists} from "./models/s3"; // Import ensureBucketExists
import {registerSchema} from "./graphql/schema-registry";
import config from "./config/index";
import {fastifyLogger, logger} from "./logger";
import "./sentry";

// Plugin to set HTTP status code based on GraphQL error codes
const httpStatusPlugin = {
    // Define requestDidStart without the problematic generic constraint
    async requestDidStart(): Promise<GraphQLRequestListener<any>> { // Use 'any' for context
        return {
            // Explicitly type requestContext parameter if needed, or rely on inference
            async willSendResponse(requestContext: any) { // Use 'any' for requestContext
                const { response, errors } = requestContext;
                // Check if there are errors and the code is UNAUTHENTICATED
                if (errors && errors.some(err => err.extensions?.code === 'UNAUTHENTICATED')) {
                    // Modify the HTTP status code
                    if (response.http) {
                         response.http.status = 401;
                    }
                }
            },
        };
    },
};


function fastifyAppClosePlugin(app) {
    return {
        async serverWillStart() {
            return {
                async drainServer() {
                    await app.close();
                },
            };
        },
    };
}

async function startApolloServer(app, typeDefs, resolvers) {
    // Keep fastify-multipart registered (without attachFieldsToBody)
    // Restore preValidation hook to use processRequest from graphql-upload
    app.addHook("preValidation", async function (request, reply) {
        // Check content-type header instead of custom flag
        if (!request.headers['content-type']?.startsWith('multipart/form-data')) {
            return;
        }
        // Process the request for graphql-upload compatibility
        request.body = await processRequest(request.raw, reply.raw, {
             // Pass upload options if needed, matching ApolloServer config
             maxFileSize: 30000000,
             maxFiles: 20,
        });
    });

    const server = new ApolloServer({
        schema: buildSubgraphSchema({typeDefs: gql(typeDefs), resolvers}),

        plugins: [
            httpStatusPlugin, // Add the custom plugin
            fastifyAppClosePlugin(app),
            ApolloServerPluginLandingPageGraphQLPlayground(),
            ApolloServerPluginDrainHttpServer({httpServer: app.server}),
        ],
        // @ts-ignore
        uploads: {
            maxFileSize: 30000000, // 30 MB
            maxFiles: 20,
        },
        // Include stack traces and more details in errors only during testing
        debug: process.env.ENV_ID === 'testing',
        formatError: (err) => {
          logger.error('GraphQL Error:', err); // Log the full error server-side regardless

          // Basic error structure
          const formattedError = {
            message: err.message,
            locations: err.locations,
            path: err.path,
            extensions: err.extensions,
          };

          // Add stack trace only in testing environment
          if (process.env.ENV_ID === 'testing' && err.extensions?.exception?.stacktrace) {
            formattedError.extensions = {
              ...formattedError.extensions,
              stacktrace: err.extensions.exception.stacktrace,
            };
          } else if (process.env.ENV_ID === 'testing' && err.originalError instanceof Error) {
             // Fallback if stacktrace isn't in extensions (might depend on error type)
             formattedError.extensions = {
               ...formattedError.extensions,
               stacktrace: err.originalError.stack?.split('\n'),
             };
          }

          return formattedError;
        },
        context: async (req) => {
            let uid;
            // Correctly access headers via req.request.headers
            const headers = req.request.headers;
            const signature = headers["internal-router-signature"] as string; // Cast if needed
            const configSig = config.routerSignature;

            // Log received headers and comparison details
            logger.debug('Context Creation Headers:', {
                'content-type': headers['content-type'], // Log content type for multipart debugging
                'internal-router-signature': signature,
                'internal-userid': headers["internal-userid"] as string, // Cast if needed
                'token': headers.token as string, // Cast if needed
                'config.routerSignature': configSig,
                'signatureMatch': signature === configSig
            });

            // signature sent by router so that it cannot be faked
            if (signature === configSig) {
                uid = headers["internal-userid"] as string; // Cast if needed
                logger.info('Context: Assigning uid from internal-userid', { uid });
            }
            // allow direct access in case of upload
            else {
                logger.info('Context: Signature mismatch or missing, attempting JWT');
                const token = headers.token as string; // Cast if needed
                if (!token) {
                     logger.warn('Context: JWT token missing');
                     uid = undefined;
                } else {
                    try {
                        const decoded = (await new Promise((resolve, reject) =>
                            jwt.verify(token, config.jwt.privateKey, function (err, decoded) {
                                if (err) {
                                    logger.error('Context: JWT verification failed', { error: err.message });
                                    reject(err); // Reject the promise on error
                                    return; // Stop execution here
                                }
                                resolve(decoded);
                            }),
                        )) as { user_id: string };
                        uid = decoded?.user_id;
                        logger.info('Context: Using JWT user_id', { uid });
                    } catch (jwtError) {
                         logger.error('Context: Caught JWT verification error', { error: jwtError instanceof Error ? jwtError.message : String(jwtError) });
                         // Explicitly do not set uid if JWT fails
                         uid = undefined;
                    }
                }
            }

            logger.info('Context: Final uid determined', { uid });
            return {
                uid,
            };
        },
    });

    await server.start();
    app.register(server.createHandler());

    return server.graphqlPath;
}

(async function main() {
    logger.info("Starting service...");

    await initStorage(logger);

    // check if its test env
    if (process.env.ENV_ID === "testing" || process.env.ENV_ID === "dev") {
        logger.info("Creating bucket for testing...");
        await ensureBucketExists();
    }

    
    orchestrator();

    const app = fastify({
        logger: fastifyLogger,
    });

    // Register fastify-multipart (still without attachFieldsToBody)
    app.register(fastifyMultipart);

    // Add health check endpoint
    app.get('/healthz', async (request, reply) => {
      // Optionally add checks for DB connection, etc. here
      return { status: 'ok' };
    });

    try {
        let schemaString = schema();

        // no need to register schema in integration test mode
        if (process.env.ENV_ID != "testing") {
            await registerSchema(schemaString);
        }

        const relPath = await startApolloServer(app, schemaString, resolvers);
        await app.listen(8800, "0.0.0.0");

        logger.info(
            `image-splitter service is ready at http://localhost:8800${relPath}`,
        );
    } catch (e) {
        logger.error(e);
    }
})();
