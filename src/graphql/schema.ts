export const schema = `
scalar JSON
scalar DateTime
scalar Upload
scalar ID
scalar URL

type Query {
	file(id:ID!): File
	hiveFiles(hiveId:ID!): [FrameSideFile]
	hiveFrameSideFile(frameSideId:ID!): FrameSideFile
	hiveFrameSideCells(frameSideId:ID!): FrameSideCells
}

type Mutation {
	uploadFrameSide(file: Upload!): File
	addFileToFrameSide(frameSideId: ID!, fileId: ID!, hiveId: ID!): Boolean
	filesStrokeEditMutation(files: [FilesUpdateInput]): Boolean

	updateFrameSideCells(cells: FrameSideCellsInput!): Boolean!
}

input FilesUpdateInput{
	frameSideId: ID!
	fileId: ID!
	strokeHistory: JSON!
}

type FrameSideFile {
	file: File!
	frameSideId: ID
	hiveId: ID
	strokeHistory: JSON

	detectedBees: JSON
	detectedQueenCount: Int
	detectedWorkerBeeCount: Int
	detectedDroneCount: Int
	isBeeDetectionComplete: Boolean

	detectedCells: JSON
	isCellsDetectionComplete: Boolean

	detectedQueenCups: JSON
	isQueenCupsDetectionComplete: Boolean

	queenDetected: Boolean!
  
	workerCount: Int
	droneCount: Int
}

type File{
	id: ID!
	url: URL!
	resizes: [FileResize]
}

type FileResize {
	id: ID!
	max_dimension_px: Int!
	url: URL!
}

extend type FrameSide @key(fields: "id") {
	id: ID @external
	file: File
}

extend type Hive @key(fields: "id") {
	id: ID! @external
	files: [FrameSideFile]
}

type FrameSideCells @key(fields: "id"){
	id: ID!
	
	broodPercent: Int
	cappedBroodPercent: Int
	eggsPercent: Int
	pollenPercent: Int
	honeyPercent: Int
}

input FrameSideCellsInput{
	id: ID!
	
	broodPercent: Int
	cappedBroodPercent: Int
	eggsPercent: Int
	pollenPercent: Int
	honeyPercent: Int
}
`;
