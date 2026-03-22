import client from "prom-client";

const register = new client.Registry();

register.setDefaultLabels({
    service: "image-splitter",
});

client.collectDefaultMetrics({ register });

export const httpRequestDurationSeconds = new client.Histogram({
    name: "image_splitter_http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [register],
});

export const httpRequestsTotal = new client.Counter({
    name: "image_splitter_http_requests_total",
    help: "Total number of HTTP requests",
    labelNames: ["method", "route", "status_code"] as const,
    registers: [register],
});

export const graphqlResolverDurationSeconds = new client.Histogram({
    name: "image_splitter_graphql_resolver_duration_seconds",
    help: "GraphQL resolver duration in seconds",
    labelNames: ["operation_type", "resolver_name", "status"] as const,
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [register],
});

export const graphqlResolverCallsTotal = new client.Counter({
    name: "image_splitter_graphql_resolver_calls_total",
    help: "Total number of GraphQL resolver calls",
    labelNames: ["operation_type", "resolver_name", "status"] as const,
    registers: [register],
});

export const dbQueryDurationSeconds = new client.Histogram({
    name: "image_splitter_db_query_duration_seconds",
    help: "Database query duration in seconds",
    labelNames: ["statement_type", "query_shape", "status"] as const,
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [register],
});

export const dbQueriesTotal = new client.Counter({
    name: "image_splitter_db_queries_total",
    help: "Total number of database queries",
    labelNames: ["statement_type", "query_shape", "status"] as const,
    registers: [register],
});

export const processingStepDurationSeconds = new client.Histogram({
    name: "image_splitter_processing_step_duration_seconds",
    help: "Image processing step duration in seconds",
    labelNames: ["step", "status"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [register],
});

export const processingStepTotal = new client.Counter({
    name: "image_splitter_processing_step_total",
    help: "Total number of image processing steps",
    labelNames: ["step", "status"] as const,
    registers: [register],
});

export function recordHttpRequest(input: {
    method: string;
    route: string;
    statusCode: number;
    durationSeconds: number;
}) {
    const labels = {
        method: input.method,
        route: input.route,
        status_code: String(input.statusCode),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, input.durationSeconds);
}

export function recordGraphqlResolverCall(input: {
    operationType: string;
    resolverName: string;
    status: "success" | "error";
    durationSeconds: number;
}) {
    const labels = {
        operation_type: input.operationType,
        resolver_name: input.resolverName,
        status: input.status,
    };

    graphqlResolverCallsTotal.inc(labels);
    graphqlResolverDurationSeconds.observe(labels, input.durationSeconds);
}

export function recordDbQuery(input: {
    statementType: string;
    queryShape: string;
    status: "success" | "error";
    durationSeconds: number;
}) {
    const labels = {
        statement_type: input.statementType,
        query_shape: input.queryShape,
        status: input.status,
    };

    dbQueriesTotal.inc(labels);
    dbQueryDurationSeconds.observe(labels, input.durationSeconds);
}

export function recordProcessingStep(input: {
    step: string;
    status: "success" | "error";
    durationSeconds: number;
}) {
    const labels = {
        step: input.step,
        status: input.status,
    };

    processingStepTotal.inc(labels);
    processingStepDurationSeconds.observe(labels, input.durationSeconds);
}

export async function measureProcessingStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
    const start = process.hrtime.bigint();

    try {
        const result = await fn();
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
        recordProcessingStep({ step, status: "success", durationSeconds });
        return result;
    } catch (error) {
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
        recordProcessingStep({ step, status: "error", durationSeconds });
        throw error;
    }
}

type ResolverMap = Record<string, any>;
type ResolverFunction = (...args: any[]) => any;

function isPromiseLike(value: unknown): value is Promise<unknown> {
    return !!value && typeof (value as { then?: unknown }).then === "function";
}

export function wrapGraphqlResolversWithMetrics<T extends ResolverMap>(resolverMap: T): T {
    const wrapped = { ...resolverMap } as ResolverMap;

    for (const [operationType, operationResolvers] of Object.entries(resolverMap)) {
        if (!operationResolvers || typeof operationResolvers !== "object" || Array.isArray(operationResolvers)) {
            continue;
        }

        const wrappedOperationResolvers = { ...operationResolvers } as ResolverMap;

        for (const [resolverName, resolver] of Object.entries(operationResolvers as ResolverMap)) {
            if (typeof resolver !== "function") {
                continue;
            }

            const originalResolver = resolver as ResolverFunction;

            wrappedOperationResolvers[resolverName] = function wrappedResolver(this: unknown, ...args: any[]) {
                const start = process.hrtime.bigint();
                const observe = (status: "success" | "error") => {
                    const elapsedNanoseconds = Number(process.hrtime.bigint() - start);
                    const durationSeconds = elapsedNanoseconds / 1_000_000_000;

                    recordGraphqlResolverCall({
                        operationType,
                        resolverName,
                        status,
                        durationSeconds,
                    });
                };

                try {
                    const result = originalResolver.apply(this, args);

                    if (isPromiseLike(result)) {
                        return result.then((value) => {
                            observe("success");
                            return value;
                        }).catch((error) => {
                            observe("error");
                            throw error;
                        });
                    }

                    observe("success");
                    return result;
                } catch (error) {
                    observe("error");
                    throw error;
                }
            };
        }

        wrapped[operationType] = wrappedOperationResolvers;
    }

    return wrapped as T;
}

export async function renderMetrics(): Promise<string> {
    return register.metrics();
}

export const metricsContentType = register.contentType;
