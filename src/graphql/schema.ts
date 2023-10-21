import * as fs from 'fs';
import * as path from 'path';

// if we are in src/graphql or in compiled app/graphql, go up
const schemaFilePath = path.join(__dirname, '..', '..', 'schema.graphql');

// Read the schema file
const schemaString = fs.readFileSync(schemaFilePath, 'utf-8');

export const schema: string = schemaString;