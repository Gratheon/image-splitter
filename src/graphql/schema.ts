export const schema = `
scalar JSON
scalar DateTime
scalar Upload
scalar ID

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
	detectedObjects: JSON
	estimatedDetectionTimeSec: Float

	counts: [DetectedObjectCount]
}

enum DetectedObjectType {
	"""n=0"""
	BEE_WORKER
	"""n=1"""
	BEE_DRONE
	"""n=3"""
	BEE_QUEEN
}

type DetectedObjectCount{
	type: DetectedObjectType
	count: Int
}

type File{
	id: ID!
	url: String
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
