import * as fs from 'fs';
import * as path from 'path';

export function schema(): string {
	// if we are in src/graphql or in compiled app/graphql, go up
	const schemaFilePath = path.join(__dirname, '..', '..', 'schema.graphql');

	// Read the schema file
	const schemaString = fs.readFileSync(schemaFilePath, 'utf-8');

	return schemaString;
}