import {ApolloServer} from "apollo-server-fastify";
import {ApolloServerPluginDrainHttpServer, ApolloServerPluginLandingPageGraphQLPlayground,} from "apollo-server-core";
import fastify from "fastify";
import {buildSubgraphSchema} from "@apollo/federation";
import {processRequest} from "graphql-upload";
import jwt from "jsonwebtoken";
import gql from "graphql-tag";

import orchestrator from "./workers/orchestrator";
import {schema} from "./graphql/schema";
import {resolvers} from "./graphql/resolvers";
import {initStorage} from "./models/storage";
import {registerSchema} from "./graphql/schema-registry";
import config from "./config/index";
import {fastifyLogger, logger} from "./logger";
import "./sentry";

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
    app.addContentTypeParser("multipart", (request, payload, done) => {
        request.isMultipart = true;
        done();
    });

    // Format the request body to follow graphql-upload's
    app.addHook("preValidation", async function (request, reply) {
        if (!request.isMultipart) {
            return;
        }

        request.body = await processRequest(request.raw, reply.raw);
    });

    const server = new ApolloServer({
        schema: buildSubgraphSchema({typeDefs: gql(typeDefs), resolvers}),

        plugins: [
            fastifyAppClosePlugin(app),
            ApolloServerPluginLandingPageGraphQLPlayground(),
            ApolloServerPluginDrainHttpServer({httpServer: app.server}),
        ],
        // @ts-ignore
        uploads: {
            maxFileSize: 30000000, // 30 MB
            maxFiles: 20,
        },
        context: async (req) => {
            let uid;
            let signature = req.request.raw.headers["internal-router-signature"];

            // signature sent by router so that it cannot be faked
            if (signature === config.routerSignature) {
                uid = req.request.raw.headers["internal-userid"];
            }

            // allow direct access in case of upload
            else {
                const token = req.request.raw.headers.token;
                const decoded = (await new Promise((resolve, reject) =>
                    jwt.verify(token, config.jwt.privateKey, function (err, decoded) {
                        if (err) {
                            reject(err);
                        }
                        resolve(decoded);
                    }),
                )) as {
                    user_id: string;
                };

                uid = decoded?.user_id;
            }

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
    orchestrator();

    const app = fastify({
        logger: fastifyLogger,
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
