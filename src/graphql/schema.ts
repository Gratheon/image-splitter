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
}

type Mutation {
	uploadFrameSide(file: Upload!): File
	addFileToFrameSide(frameSideId: ID!, fileId: ID!, hiveId: ID!): AddFileToFrameSideResult
	filesStrokeEditMutation(files: [FilesUpdateInput]): Boolean
}

input FilesUpdateInput{
	frameSideId: ID!
	fileId: ID!
	strokeHistory: JSON!
}

type AddFileToFrameSideResult{
	estimatedDetectionTimeSec: Float
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
	estimatedDetectionTimeSec: Float
	isBeeDetectionComplete: Boolean

	detectedFrameResources: JSON
	isCellsDetectionComplete: Boolean

	detectedQueenCups: JSON
	isQueenCupsDetectionComplete: Boolean
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
`;
